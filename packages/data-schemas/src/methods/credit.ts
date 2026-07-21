import type { FilterQuery, Model } from 'mongoose';
import type {
  AddCreditPackageInput,
  AddCreditPackageResult,
  CreditBillingStatus,
  CreditPackageWithRemaining,
  ICreditMonth,
  ICreditPackage,
  ICreditSpend,
  RecordCreditSpendInput,
  RecordCreditSpendResult,
} from '~/types';
import { creditsToMicroUsd } from '~/common/credit';
import logger from '~/config/winston';

const DUP_KEY_CODE = 11000;
/** Notification threshold as a fraction of the monthly pool. */
const POOL_NOTIFY_RATIO = 0.8;

/**
 * Billing period = a rolling «month of service» anchored to the contour's service
 * start day, in the client's calendar (Europe/Minsk, UTC+3, no DST). `anchorDay` is
 * the day-of-month the service went live; period n is
 * `[anchorDay of month m+n, anchorDay of month m+n+1)`. `anchorDay` defaults to 1,
 * which reproduces exact calendar-month billing bit-for-bit (just keyed `YYYY-MM-01`).
 *
 * The period document is created lazily on the first spend of a period, so the
 * «reset at the start of each period» needs no cron — a new period simply keys a
 * fresh document (its key is the Minsk period-start date, `YYYY-MM-DD`) with spent = 0.
 *
 * Clamp: when `anchorDay` (29/30/31) does not exist in a month, that month's boundary
 * is its last day; the next month returns to `anchorDay` where it exists. E.g.
 * `anchorDay = 31` → 01-31, 02-28, 03-31, 04-30, 05-31 …
 */

/** Civil (wall-clock) fields in Europe/Minsk for an instant. */
const MINSK_CIVIL_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Minsk',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

interface CivilParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  second: number;
}

function minskCivil(at: Date): CivilParts {
  const parts = MINSK_CIVIL_FMT.formatToParts(at);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** Days in a civil month (month is 1-12; day 0 of month+1 is the last of month). */
function daysInCivilMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Normalises an anchor day to an integer in [1, 31]; anything invalid falls back to
 * 1 (calendar-month billing), so a missing/garbled config can never break billing.
 */
export function normalizeAnchorDay(day: number | undefined | null): number {
  if (typeof day !== 'number' || !Number.isFinite(day)) {
    return 1;
  }
  const d = Math.trunc(day);
  if (d < 1) {
    return 1;
  }
  if (d > 31) {
    return 31;
  }
  return d;
}

/** The anchor day clamped into a given month (e.g. 31 → 28 in a non-leap February). */
function clampAnchorToMonth(year: number, month: number, anchorDay: number): number {
  return Math.min(anchorDay, daysInCivilMonth(year, month));
}

/**
 * The UTC instant of Minsk 00:00 on a civil date. Minsk observes no DST, so the zone
 * offset at the civil date's UTC guess equals the offset at true local midnight — a
 * single correction is exact (no iteration needed). Used only for display bounds; the
 * period *key* is pure civil-date arithmetic and never depends on this instant.
 */
function minskMidnightInstant(year: number, month: number, day: number): Date {
  const utcGuess = Date.UTC(year, month - 1, day, 0, 0, 0);
  const civil = minskCivil(new Date(utcGuess));
  const asUtc = Date.UTC(
    civil.year,
    civil.month - 1,
    civil.day,
    civil.hour,
    civil.minute,
    civil.second,
  );
  const offsetMs = asUtc - utcGuess; // +3h for Minsk
  return new Date(utcGuess - offsetMs);
}

/** The civil {year, month, day} that the period containing `at` starts on. */
function periodStartCivil(
  at: Date,
  anchorDay: number,
): { year: number; month: number; day: number } {
  const { year, month, day } = minskCivil(at);
  const anchorThisMonth = clampAnchorToMonth(year, month, anchorDay);
  if (day >= anchorThisMonth) {
    return { year, month, day: anchorThisMonth };
  }
  // Before this month's anchor → the period started in the previous month.
  let py = year;
  let pm = month - 1;
  if (pm === 0) {
    pm = 12;
    py -= 1;
  }
  return { year: py, month: pm, day: clampAnchorToMonth(py, pm, anchorDay) };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * The `YYYY-MM-DD` key of the service period containing `at` (its Minsk start date).
 * `anchorDay` defaults to 1 → `YYYY-MM-01`, i.e. exact calendar-month keys.
 */
export function servicePeriodKey(at: Date = new Date(), anchorDay: number = 1): string {
  const { year, month, day } = periodStartCivil(at, normalizeAnchorDay(anchorDay));
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** The [start, end) instants of the service period containing `at` (end exclusive). */
export function servicePeriodBounds(
  at: Date = new Date(),
  anchorDay: number = 1,
): { start: Date; end: Date } {
  const anchor = normalizeAnchorDay(anchorDay);
  const s = periodStartCivil(at, anchor);
  let ny = s.year;
  let nm = s.month + 1;
  if (nm === 13) {
    nm = 1;
    ny += 1;
  }
  const nextDay = clampAnchorToMonth(ny, nm, anchor);
  return {
    start: minskMidnightInstant(s.year, s.month, s.day),
    end: minskMidnightInstant(ny, nm, nextDay),
  };
}

/** Immutable fields seeded into a period document the first time it is touched. */
function periodInsertFields(
  at: Date,
  anchorDay: number,
  poolMicroUsd: number,
): { poolMicroUsd: number; periodStart: Date; periodEnd: Date } {
  const { start, end } = servicePeriodBounds(at, anchorDay);
  return { poolMicroUsd: Math.round(poolMicroUsd), periodStart: start, periodEnd: end };
}

function isDupKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: number }).code === DUP_KEY_CODE
  );
}

/** Builds a tenant-scoped filter, omitting `tenantId` entirely when not provided. */
function tenantFilter<T>(tenantId?: string): FilterQuery<T> {
  return (tenantId ? { tenantId } : {}) as FilterQuery<T>;
}

export function createCreditMethods(mongoose: typeof import('mongoose')): {
  recordCreditSpend: (input: RecordCreditSpendInput) => Promise<RecordCreditSpendResult>;
  getCreditBillingStatus: (params: {
    poolMicroUsd: number;
    tenantId?: string;
    anchorDay?: number;
    at?: Date;
  }) => Promise<CreditBillingStatus>;
  /**
   * Read-only variant of {@link getCreditBillingStatus} for the per-request soft-block
   * gate: never upserts, so the hot polling path performs no write. A period with no
   * document yet reads as spent = 0 (not blocked) — the document is created on the
   * first actual spend.
   */
  getCreditGateStatus: (params: {
    poolMicroUsd: number;
    tenantId?: string;
    anchorDay?: number;
    at?: Date;
  }) => Promise<CreditBillingStatus>;
  addCreditPackage: (input: AddCreditPackageInput) => Promise<AddCreditPackageResult>;
  listCreditPackages: (params?: {
    tenantId?: string;
  }) => Promise<{ packages: CreditPackageWithRemaining[]; packageSpentMicroUsd: number }>;
  markCreditMonthNotified: (params: {
    month: string;
    kind: '80' | 'exhausted';
    tenantId?: string;
  }) => Promise<boolean>;
  getCreditMonth: (params: { month: string; tenantId?: string }) => Promise<ICreditMonth | null>;
  sumCreditSpendJournal: (params: {
    month: string;
    tenantId?: string;
  }) => Promise<{ microUsd: number; count: number }>;
  /**
   * Journal sum over a wall-clock instant range (by `createdAt`) — used for the
   * external OpenRouter reconciliation, whose `usage_monthly` window is a UTC
   * calendar month independent of the billing period.
   */
  sumCreditSpendJournalRange: (params: {
    from: Date;
    to: Date;
    tenantId?: string;
  }) => Promise<{ microUsd: number; count: number }>;
} {
  function CreditMonth(): Model<ICreditMonth> {
    return mongoose.models.CreditMonth as Model<ICreditMonth>;
  }
  function CreditPackage(): Model<ICreditPackage> {
    return mongoose.models.CreditPackage as Model<ICreditPackage>;
  }
  function CreditSpend(): Model<ICreditSpend> {
    return mongoose.models.CreditSpend as Model<ICreditSpend>;
  }

  /**
   * Upserts the month document, tolerating the upsert race (two concurrent
   * first-spends of a month both try to insert; the loser retries as an update).
   */
  async function upsertMonth(
    filter: FilterQuery<ICreditMonth>,
    update: Record<string, unknown>,
  ): Promise<ICreditMonth> {
    for (let attempt = 0; ; attempt++) {
      try {
        const doc = await CreditMonth()
          .findOneAndUpdate(filter, update, { upsert: true, new: true })
          .lean<ICreditMonth>();
        if (doc) {
          return doc;
        }
        throw new Error('[credit] month upsert returned no document');
      } catch (error) {
        if (isDupKeyError(error) && attempt < 3) {
          continue;
        }
        throw error;
      }
    }
  }

  /**
   * Records one request's actual cost into the ledger.
   *
   * Ordering: the journal row is written FIRST (deduped by `sourceId`), the month
   * counter second. A crash in between undercounts by one request — preferable to
   * double-charging on reporter retries; the OpenRouter reconciliation catches drift.
   * There is no multi-document transaction on purpose: the deploy target is a
   * standalone MongoDB where transactions are unavailable.
   */
  async function recordCreditSpend(
    input: RecordCreditSpendInput,
  ): Promise<RecordCreditSpendResult> {
    if (!Number.isFinite(input.microUsd) || input.microUsd < 0) {
      throw new Error(`[credit] invalid microUsd: ${input.microUsd}`);
    }
    if (!Number.isFinite(input.poolMicroUsd) || input.poolMicroUsd <= 0) {
      throw new Error(`[credit] invalid poolMicroUsd: ${input.poolMicroUsd}`);
    }
    const at = input.at ?? new Date();
    const anchorDay = normalizeAnchorDay(input.anchorDay);
    const month = servicePeriodKey(at, anchorDay);
    const microUsd = Math.round(input.microUsd);

    try {
      await CreditSpend().create({
        ...(input.tenantId ? { tenantId: input.tenantId } : {}),
        month,
        microUsd,
        model: input.model,
        userId: input.userId,
        sourceId: input.sourceId,
        context: input.context,
      });
    } catch (error) {
      if (input.sourceId && isDupKeyError(error)) {
        // Reporter retry of an already-journaled response: do NOT re-increment the month.
        const existing = await CreditMonth()
          .findOne({ ...tenantFilter<ICreditMonth>(input.tenantId), month })
          .lean<ICreditMonth>();
        const spent = existing?.spentMicroUsd ?? 0;
        return {
          duplicate: true,
          month,
          poolMicroUsd: existing?.poolMicroUsd ?? Math.round(input.poolMicroUsd),
          spentBeforeMicroUsd: spent,
          spentAfterMicroUsd: spent,
          crossed80: false,
          crossedPool: false,
          notified80At: existing?.notified80At ?? null,
          notifiedExhaustedAt: existing?.notifiedExhaustedAt ?? null,
        };
      }
      throw error;
    }

    const after = await upsertMonth(
      { ...tenantFilter<ICreditMonth>(input.tenantId), month },
      {
        $inc: { spentMicroUsd: microUsd, requestCount: 1 },
        $setOnInsert: periodInsertFields(at, anchorDay, input.poolMicroUsd),
      },
    );

    const pool = after.poolMicroUsd;
    const spentAfter = after.spentMicroUsd;
    const spentBefore = spentAfter - microUsd;
    const threshold80 = pool * POOL_NOTIFY_RATIO;

    return {
      duplicate: false,
      month,
      poolMicroUsd: pool,
      spentBeforeMicroUsd: spentBefore,
      spentAfterMicroUsd: spentAfter,
      crossed80: spentBefore < threshold80 && spentAfter >= threshold80,
      crossedPool: spentBefore < pool && spentAfter >= pool,
      notified80At: after.notified80At ?? null,
      notifiedExhaustedAt: after.notifiedExhaustedAt ?? null,
    };
  }

  /**
   * Package totals across the whole contract term:
   *   purchased = Σ lot sizes, SIGNED — a negative adjustment reduces the granted total;
   *   spent     = Σ over months of max(0, monthSpent − monthPool).
   * Lots are immutable — the split is *derived*, so concurrent spends can never
   * corrupt per-lot balances (a boundary overrun only shows as remaining < 0).
   */
  async function getPackageTotals(
    tenantId?: string,
  ): Promise<{ purchasedMicroUsd: number; packageSpentMicroUsd: number }> {
    const [pkg] = await CreditPackage().aggregate<{ purchased: number }>([
      { $match: tenantFilter(tenantId) },
      { $group: { _id: null, purchased: { $sum: '$microUsd' } } },
    ]);
    const [overflow] = await CreditMonth().aggregate<{ overflow: number }>([
      { $match: tenantFilter(tenantId) },
      {
        $group: {
          _id: null,
          overflow: { $sum: { $max: [0, { $subtract: ['$spentMicroUsd', '$poolMicroUsd'] }] } },
        },
      },
    ]);
    return {
      purchasedMicroUsd: pkg?.purchased ?? 0,
      packageSpentMicroUsd: overflow?.overflow ?? 0,
    };
  }

  /**
   * Current billing status. Creates the month document on first touch (lazy reset).
   * Soft block = the monthly pool is exhausted AND no package credits remain; both
   * a new month and a package top-up therefore lift the block automatically.
   */
  async function getCreditBillingStatus(params: {
    poolMicroUsd: number;
    tenantId?: string;
    anchorDay?: number;
    at?: Date;
  }): Promise<CreditBillingStatus> {
    const at = params.at ?? new Date();
    const anchorDay = normalizeAnchorDay(params.anchorDay);
    const month = servicePeriodKey(at, anchorDay);
    const doc = await upsertMonth(
      { ...tenantFilter<ICreditMonth>(params.tenantId), month },
      { $setOnInsert: periodInsertFields(at, anchorDay, params.poolMicroUsd) },
    );
    const { purchasedMicroUsd, packageSpentMicroUsd } = await getPackageTotals(params.tenantId);
    const packageRemainingMicroUsd = purchasedMicroUsd - packageSpentMicroUsd;
    return {
      month,
      poolMicroUsd: doc.poolMicroUsd,
      spentMicroUsd: doc.spentMicroUsd,
      requestCount: doc.requestCount,
      purchasedMicroUsd,
      packageSpentMicroUsd,
      packageRemainingMicroUsd,
      blocked: doc.spentMicroUsd >= doc.poolMicroUsd && packageRemainingMicroUsd <= 0,
      notified80At: doc.notified80At ?? null,
      notifiedExhaustedAt: doc.notifiedExhaustedAt ?? null,
      periodStart: doc.periodStart ?? null,
      periodEnd: doc.periodEnd ?? null,
    };
  }

  /**
   * Read-only status for the per-request soft-block gate. Unlike
   * {@link getCreditBillingStatus} it never upserts, so the hot polling path does no
   * write. A period whose document does not exist yet reads as spent = 0 (never
   * blocked): the pool is positive, and the document will be created by the first
   * actual spend. Package totals are still global (across all periods).
   */
  async function getCreditGateStatus(params: {
    poolMicroUsd: number;
    tenantId?: string;
    anchorDay?: number;
    at?: Date;
  }): Promise<CreditBillingStatus> {
    const at = params.at ?? new Date();
    const anchorDay = normalizeAnchorDay(params.anchorDay);
    const month = servicePeriodKey(at, anchorDay);
    const doc = await CreditMonth()
      .findOne({ ...tenantFilter<ICreditMonth>(params.tenantId), month })
      .lean<ICreditMonth>();
    const { purchasedMicroUsd, packageSpentMicroUsd } = await getPackageTotals(params.tenantId);
    const packageRemainingMicroUsd = purchasedMicroUsd - packageSpentMicroUsd;
    const poolMicroUsd = doc?.poolMicroUsd ?? Math.round(params.poolMicroUsd);
    const spentMicroUsd = doc?.spentMicroUsd ?? 0;
    const bounds = servicePeriodBounds(at, anchorDay);
    return {
      month,
      poolMicroUsd,
      spentMicroUsd,
      requestCount: doc?.requestCount ?? 0,
      purchasedMicroUsd,
      packageSpentMicroUsd,
      packageRemainingMicroUsd,
      blocked: spentMicroUsd >= poolMicroUsd && packageRemainingMicroUsd <= 0,
      notified80At: doc?.notified80At ?? null,
      notifiedExhaustedAt: doc?.notifiedExhaustedAt ?? null,
      periodStart: doc?.periodStart ?? bounds.start,
      periodEnd: doc?.periodEnd ?? bounds.end,
    };
  }

  /**
   * Adds a credit lot — a purchased package or a manual adjustment. Idempotent by
   * `idempotencyKey` (unique index): a replay returns the existing lot with
   * `created: false` and changes nothing. A *positive* insert resets the current
   * month's «exhausted» notification flag so a later re-exhaustion notifies again;
   * a negative adjustment must not re-arm it (nothing was granted).
   */
  async function addCreditPackage(input: AddCreditPackageInput): Promise<AddCreditPackageResult> {
    const kind = input.kind ?? 'package';
    if (!Number.isInteger(input.credits) || input.credits === 0) {
      throw new Error(`[credit] invalid lot size: ${input.credits}`);
    }
    if (kind === 'package' && input.credits < 0) {
      throw new Error(`[credit] a package cannot be negative: ${input.credits}`);
    }
    if (!input.idempotencyKey || typeof input.idempotencyKey !== 'string') {
      throw new Error('[credit] idempotencyKey is required');
    }
    try {
      const created = await CreditPackage().create({
        ...(input.tenantId ? { tenantId: input.tenantId } : {}),
        kind,
        credits: input.credits,
        microUsd: creditsToMicroUsd(input.credits),
        comment: input.comment,
        invoiceRef: input.invoiceRef,
        addedByEmail: input.addedByEmail,
        addedById: input.addedById,
        idempotencyKey: input.idempotencyKey,
      });
      if (input.credits > 0) {
        const month = servicePeriodKey(input.at ?? new Date(), normalizeAnchorDay(input.anchorDay));
        await CreditMonth()
          .updateOne(
            { ...tenantFilter<ICreditMonth>(input.tenantId), month },
            { $set: { notifiedExhaustedAt: null } },
          )
          .catch((error) => {
            logger.warn('[credit] failed to reset exhausted-notification flag:', error);
          });
      }
      return { created: true, package: created.toObject() as ICreditPackage };
    } catch (error) {
      if (!isDupKeyError(error)) {
        throw error;
      }
      const existing = await CreditPackage()
        .findOne({
          ...tenantFilter<ICreditPackage>(input.tenantId),
          idempotencyKey: input.idempotencyKey,
        })
        .lean<ICreditPackage>();
      if (!existing) {
        throw error;
      }
      return { created: false, package: existing };
    }
  }

  /**
   * Lots with FIFO-derived remaining amounts (oldest positive lots drain first),
   * newest-first for display. The last partially-drained lot absorbs any boundary
   * overrun (its remaining is clamped at 0 for callers to display).
   *
   * A negative adjustment holds no balance of its own — it *is* a drain. Summing it
   * into `toDrain` (rather than letting it flow through the per-lot arithmetic, where
   * a negative `lot.microUsd` would run the drain backwards) keeps the screen honest:
   * Σ of the displayed remainders equals the headline `packageRemainingMicroUsd`.
   */
  async function listCreditPackages(params?: {
    tenantId?: string;
  }): Promise<{ packages: CreditPackageWithRemaining[]; packageSpentMicroUsd: number }> {
    const { packageSpentMicroUsd } = await getPackageTotals(params?.tenantId);
    const lots = await CreditPackage()
      .find(tenantFilter<ICreditPackage>(params?.tenantId))
      .sort({ createdAt: 1, _id: 1 })
      .lean<ICreditPackage[]>();

    let toDrain = lots.reduce((sum, lot) => sum + Math.max(0, -lot.microUsd), packageSpentMicroUsd);
    const withRemaining: CreditPackageWithRemaining[] = lots.map((lot) => {
      const drained = lot.microUsd > 0 ? Math.min(Math.max(toDrain, 0), lot.microUsd) : 0;
      toDrain -= drained;
      return {
        id: String(lot._id),
        kind: lot.kind ?? 'package',
        credits: lot.credits,
        microUsd: lot.microUsd,
        remainingMicroUsd: lot.microUsd > 0 ? lot.microUsd - drained : 0,
        comment: lot.comment,
        invoiceRef: lot.invoiceRef,
        addedByEmail: lot.addedByEmail,
        createdAt: lot.createdAt,
      };
    });

    return { packages: withRemaining.reverse(), packageSpentMicroUsd };
  }

  /**
   * Claims the right to send a notification exactly once: flips the flag from
   * null to now atomically. Returns true only for the single winning caller.
   */
  async function markCreditMonthNotified(params: {
    month: string;
    kind: '80' | 'exhausted';
    tenantId?: string;
  }): Promise<boolean> {
    const field = params.kind === '80' ? 'notified80At' : 'notifiedExhaustedAt';
    const updated = await CreditMonth()
      .findOneAndUpdate(
        { ...tenantFilter<ICreditMonth>(params.tenantId), month: params.month, [field]: null },
        { $set: { [field]: new Date() } },
        { new: true },
      )
      .lean<ICreditMonth>();
    return updated != null;
  }

  async function getCreditMonth(params: {
    month: string;
    tenantId?: string;
  }): Promise<ICreditMonth | null> {
    return CreditMonth()
      .findOne({ ...tenantFilter<ICreditMonth>(params.tenantId), month: params.month })
      .lean<ICreditMonth>();
  }

  /** Journal sum for a period — must equal the period counter (rounding-convergence check). */
  async function sumCreditSpendJournal(params: {
    month: string;
    tenantId?: string;
  }): Promise<{ microUsd: number; count: number }> {
    const [row] = await CreditSpend().aggregate<{ microUsd: number; count: number }>([
      { $match: { ...tenantFilter(params.tenantId), month: params.month } },
      { $group: { _id: null, microUsd: { $sum: '$microUsd' }, count: { $sum: 1 } } },
    ]);
    return { microUsd: row?.microUsd ?? 0, count: row?.count ?? 0 };
  }

  /**
   * Journal sum over a wall-clock instant range (by `createdAt`, `[from, to)`).
   * Independent of the billing-period key — the external OpenRouter reconciliation
   * compares against `usage_monthly`, whose window is a UTC calendar month. The
   * `createdAt` TTL index serves this range scan.
   */
  async function sumCreditSpendJournalRange(params: {
    from: Date;
    to: Date;
    tenantId?: string;
  }): Promise<{ microUsd: number; count: number }> {
    const [row] = await CreditSpend().aggregate<{ microUsd: number; count: number }>([
      {
        $match: {
          ...tenantFilter(params.tenantId),
          createdAt: { $gte: params.from, $lt: params.to },
        },
      },
      { $group: { _id: null, microUsd: { $sum: '$microUsd' }, count: { $sum: 1 } } },
    ]);
    return { microUsd: row?.microUsd ?? 0, count: row?.count ?? 0 };
  }

  return {
    recordCreditSpend,
    getCreditBillingStatus,
    getCreditGateStatus,
    addCreditPackage,
    listCreditPackages,
    markCreditMonthNotified,
    getCreditMonth,
    sumCreditSpendJournal,
    sumCreditSpendJournalRange,
  };
}

export type CreditMethods = ReturnType<typeof createCreditMethods>;
