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
 * The billing month boundary is the client's calendar: Europe/Minsk (UTC+3, no DST).
 * The month document is created lazily on first touch, so the «1st of month reset»
 * needs no cron — a new Minsk month simply keys a fresh document with spent = 0.
 */
const MINSK_MONTH_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Minsk',
  year: 'numeric',
  month: '2-digit',
});

/** Returns the `YYYY-MM` Europe/Minsk month key for a timestamp. */
export function minskMonthKey(at: Date = new Date()): string {
  const parts = MINSK_MONTH_FMT.formatToParts(at);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  return `${year}-${month}`;
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
    const month = minskMonthKey(at);
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
        $setOnInsert: { poolMicroUsd: Math.round(input.poolMicroUsd) },
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
   *   purchased = Σ lot sizes;
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
    at?: Date;
  }): Promise<CreditBillingStatus> {
    const month = minskMonthKey(params.at ?? new Date());
    const doc = await upsertMonth(
      { ...tenantFilter<ICreditMonth>(params.tenantId), month },
      { $setOnInsert: { poolMicroUsd: Math.round(params.poolMicroUsd) } },
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
    };
  }

  /**
   * Adds a purchased package lot. Idempotent by `idempotencyKey` (unique index):
   * a replay returns the existing lot with `created: false` and changes nothing.
   * On a real insert the current month's «exhausted» notification flag is reset,
   * so a *later* re-exhaustion notifies again.
   */
  async function addCreditPackage(input: AddCreditPackageInput): Promise<AddCreditPackageResult> {
    if (!Number.isInteger(input.credits) || input.credits <= 0) {
      throw new Error(`[credit] invalid package size: ${input.credits}`);
    }
    if (!input.idempotencyKey || typeof input.idempotencyKey !== 'string') {
      throw new Error('[credit] idempotencyKey is required');
    }
    try {
      const created = await CreditPackage().create({
        ...(input.tenantId ? { tenantId: input.tenantId } : {}),
        credits: input.credits,
        microUsd: creditsToMicroUsd(input.credits),
        comment: input.comment,
        invoiceRef: input.invoiceRef,
        addedByEmail: input.addedByEmail,
        addedById: input.addedById,
        idempotencyKey: input.idempotencyKey,
      });
      const month = minskMonthKey(input.at ?? new Date());
      await CreditMonth()
        .updateOne(
          { ...tenantFilter<ICreditMonth>(input.tenantId), month },
          { $set: { notifiedExhaustedAt: null } },
        )
        .catch((error) => {
          logger.warn('[credit] failed to reset exhausted-notification flag:', error);
        });
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
   * Lots with FIFO-derived remaining amounts (oldest purchases drain first),
   * newest-first for display. The last partially-drained lot absorbs any
   * boundary overrun (its remaining is clamped at 0 for callers to display).
   */
  async function listCreditPackages(params?: {
    tenantId?: string;
  }): Promise<{ packages: CreditPackageWithRemaining[]; packageSpentMicroUsd: number }> {
    const { packageSpentMicroUsd } = await getPackageTotals(params?.tenantId);
    const lots = await CreditPackage()
      .find(tenantFilter<ICreditPackage>(params?.tenantId))
      .sort({ createdAt: 1, _id: 1 })
      .lean<ICreditPackage[]>();

    let toDrain = packageSpentMicroUsd;
    const withRemaining: CreditPackageWithRemaining[] = lots.map((lot) => {
      const drained = Math.min(Math.max(toDrain, 0), lot.microUsd);
      toDrain -= drained;
      return {
        id: String(lot._id),
        credits: lot.credits,
        microUsd: lot.microUsd,
        remainingMicroUsd: lot.microUsd - drained,
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

  /** Journal sum for a month — must equal the month counter (rounding-convergence check). */
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

  return {
    recordCreditSpend,
    getCreditBillingStatus,
    addCreditPackage,
    listCreditPackages,
    markCreditMonthNotified,
    getCreditMonth,
    sumCreditSpendJournal,
  };
}

export type CreditMethods = ReturnType<typeof createCreditMethods>;
