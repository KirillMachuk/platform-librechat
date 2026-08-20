import { logger, microUsdToCredits, MICRO_USD_PER_USD } from '@librechat/data-schemas';
import type { AuditLogInput, CreditBillingStatus } from '@librechat/data-schemas';
import type { OpenRouterManagement, OpenRouterKeyInfo } from './openrouter';
import type { BillingAlert } from './types';
import { computeKeyLimitUsd, shouldApplyKeyLimit } from './openrouter';

/** Alert when internal ledger vs OpenRouter drift exceeds ~3%… */
const DEFAULT_THRESHOLD_RATIO = 0.03;
/** …and at least this many dollars (early-month percentages are pure noise). */
const DEFAULT_MIN_ABS_USD = 1;
/**
 * Internal journal↔counter drift below this is noise: the month-counter snapshot
 * and the journal aggregation are not one atomic read, so an in-flight spend can
 * show up as sub-dollar drift. $1 mirrors the external floor — only accumulation
 * beyond it (a genuine lost increment building up) is actionable.
 */
const INTERNAL_DRIFT_TOLERANCE_MICRO_USD = MICRO_USD_PER_USD; // $1
/** Shout about the key's own budget once fewer than this many months of headroom remain. */
const KEY_BUDGET_WARN_MONTHS = 3;
/** …or once this little of the limit is left, whichever comes first. */
const KEY_BUDGET_WARN_RATIO = 0.25;
/** Skip the OpenRouter comparison during the first hours of a fresh UTC month. */
const EARLY_MONTH_SKIP_HOURS = 6;

/**
 * The external comparison uses OpenRouter's `usage_monthly`, whose window is a UTC
 * calendar month, matched against the journal summed over the same UTC month. Right
 * after the UTC 1st both sides read ~0 and any percentage is pure noise — skipped.
 */
function isEarlyUtcMonth(at: Date): boolean {
  return at.getUTCDate() === 1 && at.getUTCHours() < EARLY_MONTH_SKIP_HOURS;
}

/** First instant of the UTC calendar month containing `at`. */
function startOfUtcMonth(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1, 0, 0, 0));
}

/**
 * The ledger's own consistency: the period's per-request journal sum against the
 * period counter. They are written from the same rounded µ$ value, so they must be
 * equal; persistent drift means a counter increment was lost (a crash between the
 * journal write and the `$inc`).
 *
 * It matters more than it looks: the admin «Расходы» screen reads its header from the
 * COUNTER and the per-employee breakdown from the JOURNAL. Drift makes that one screen
 * contradict itself again — the exact defect the ledger-sourced breakdown was built to
 * remove — and nothing else would notice.
 */
export interface InternalDriftReport {
  /** Billing-period key (`YYYY-MM-DD`). */
  month: string;
  journalMicroUsd: number;
  counterMicroUsd: number;
  rows: number;
  /** journal − counter; positive means the counter under-counts. */
  driftMicroUsd: number;
  /** Beyond the in-flight tolerance — actionable. */
  drifted: boolean;
  checkedAt: Date;
}

export interface ReconcileReport {
  configured: boolean;
  /** Current billing-period key (`YYYY-MM-DD`) — context for the internal check. */
  month?: string;
  /** External comparison (this UTC calendar month): ledger journal vs OpenRouter usage. */
  ledgerCredits?: number;
  openrouterCredits?: number;
  /** Operator-facing dollar figures for the external (UTC-month) comparison. */
  ledgerUsd?: number;
  openrouterUsd?: number;
  /** Internal check (µ$): the period journal sum and its drift from the period counter — ~0. */
  journalMicroUsd?: number;
  internalDriftMicroUsd?: number;
  diffPercent?: number | null;
  alerted?: boolean;
  reason?: string;
}

export interface BillingReconcilerDeps {
  openrouter: OpenRouterManagement;
  getCreditBillingStatus: (params: {
    poolMicroUsd: number;
    tenantId?: string;
    anchorDay?: number;
    at?: Date;
  }) => Promise<CreditBillingStatus>;
  /** Journal sum for a period — reconciled against the period counter (internal check). */
  sumCreditSpendJournal: (params: {
    month: string;
    tenantId?: string;
  }) => Promise<{ microUsd: number; count: number }>;
  /** Journal sum over a UTC-month instant range — matched against OpenRouter `usage_monthly`. */
  sumCreditSpendJournalRange: (params: {
    from: Date;
    to: Date;
    tenantId?: string;
  }) => Promise<{ microUsd: number; count: number }>;
  /** When metering first recorded anything — guards the comparison in its first month. */
  getFirstCreditSpendAt: (params?: { tenantId?: string }) => Promise<Date | null>;
  /**
   * Claims the once-per-period right to send an alert. Optional so a caller that has not
   * wired it keeps the old (every-run) behaviour rather than losing alerts entirely.
   */
  markCreditMonthNotified?: (params: {
    month: string;
    kind: '80' | 'exhausted' | 'reconcile';
    tenantId?: string;
  }) => Promise<boolean>;
  poolMicroUsd: number;
  tenantId?: string;
  /** Service-period anchor day (1–31; defaults to 1). */
  anchorDay?: number;
  sendAlert: (alert: BillingAlert) => Promise<void>;
  recordAudit: (event: AuditLogInput) => void;
  /** OpenRouter key-limit headroom over the allowed volume (e.g. 0.1 = +10%). */
  headroom?: number;
  thresholdRatio?: number;
  minAbsUsd?: number;
}

/**
 * Two reconciliations in one pass:
 *  1. Internal — the current period's per-request journal sum vs the period counter
 *     (catches a lost counter increment); logged, never auto-fixed.
 *  2. External — the journal summed over the current UTC calendar month vs the
 *     OpenRouter key's `usage_monthly`. Both windows are the same UTC month by
 *     construction (the journal is summed by `createdAt`, independent of the rolling
 *     billing period), so only in-flight/dropped reports and OpenRouter accounting
 *     lag remain; the 3% + $1 tolerance absorbs those, and the first few hours of a
 *     new UTC month are skipped outright (both sides read ~0).
 */
export function createBillingReconciler(deps: BillingReconcilerDeps): {
  run: (now?: Date) => Promise<ReconcileReport>;
  checkInternalDrift: (now?: Date, known?: CreditBillingStatus) => Promise<InternalDriftReport>;
} {
  const threshold = deps.thresholdRatio ?? DEFAULT_THRESHOLD_RATIO;
  const minAbsUsd = deps.minAbsUsd ?? DEFAULT_MIN_ABS_USD;

  /**
   * Keeps the key's hard fuse aligned with the volume the contour may currently spend.
   * A package top-up syncs it immediately (admin path); this daily pass covers what
   * moves on its own — a new billing period, drained packages, a changed pool size.
   * PATCHes only on an actual change, and a failure never aborts the reconciliation:
   * a stale fuse is a risk to flag, not a reason to also lose the drift check.
   *
   * Never lands the fuse at or below what the key has ALREADY burned in this UTC
   * window. Packages drain, so the computed limit legitimately falls during a month —
   * and a limit under the accrued usage does not «tighten» anything, it trips the key
   * instantly and kills every model contour-wide while the client still has pool left.
   * That is the exact outage this whole fuse exists to prevent, so the sync declines to
   * cause it and says so; the real ceiling is the soft block, which is period-accurate.
   */
  async function syncKeyLimit(status: CreditBillingStatus, key: OpenRouterKeyInfo) {
    const desiredLimitUsd = computeKeyLimitUsd({
      poolMicroUsd: deps.poolMicroUsd,
      packageRemainingMicroUsd: status.packageRemainingMicroUsd,
      anchorDay: deps.anchorDay,
      headroom: deps.headroom,
    });
    if (!shouldApplyKeyLimit(key, desiredLimitUsd)) {
      if (key.limitUsd !== desiredLimitUsd) {
        logger.warn(
          `[billingReconcile] REFUSING to set the key limit to $${desiredLimitUsd}: the key has already used $${key.usageMonthlyUsd?.toFixed(2)} this UTC month, so that limit would cut every model immediately. Fuse left at $${key.limitUsd ?? 'unlimited'}.`,
        );
      }
      return;
    }
    try {
      await deps.openrouter.updateLimit(desiredLimitUsd);
      /* The admin and CLI paths audit every fuse move; an unattended one must too, or a
       * contour-wide cut has no record of who narrowed the limit and when. */
      deps.recordAudit({
        actorRole: 'RECONCILER',
        action: 'billing.limit_updated',
        targetType: 'billing',
        targetId: 'openrouter-key',
        metadata: { limitUsd: desiredLimitUsd, previousLimitUsd: key.limitUsd ?? 0 },
      });
    } catch (error) {
      logger.error(
        `[billingReconcile] key limit sync failed (fuse stays at $${key.limitUsd ?? 'unlimited'}, wanted $${desiredLimitUsd}):`,
        error,
      );
    }
  }

  /**
   * The internal half, on its own — it needs nothing but the database.
   *
   * Kept callable without {@link run} on purpose: the OpenRouter comparison requires a
   * management key, and on this stand there is none, so folding this check into `run`
   * meant the cheap invariant that guards the «Расходы» screen was never evaluated
   * either. A check that only runs when an unrelated integration is configured is a
   * check that does not run.
   *
   * `known` lets a caller that already fetched the status reuse it; standalone callers
   * omit it and pay one extra read.
   */
  async function checkInternalDrift(
    now: Date = new Date(),
    known?: CreditBillingStatus,
  ): Promise<InternalDriftReport> {
    const status =
      known ??
      (await deps.getCreditBillingStatus({
        poolMicroUsd: deps.poolMicroUsd,
        tenantId: deps.tenantId,
        anchorDay: deps.anchorDay,
        at: now,
      }));
    const journal = await deps.sumCreditSpendJournal({
      month: status.month,
      tenantId: deps.tenantId,
    });
    const driftMicroUsd = journal.microUsd - status.spentMicroUsd;
    const drifted = Math.abs(driftMicroUsd) > INTERNAL_DRIFT_TOLERANCE_MICRO_USD;
    if (drifted) {
      logger.error(
        `[billingReconcile] INTERNAL drift for period ${status.month}: journal=${journal.microUsd}µ$ (${journal.count} rows) vs period counter=${status.spentMicroUsd}µ$ (Δ=${driftMicroUsd}µ$). ` +
          'Likely a lost counter increment (crash between the journal write and the $inc). ' +
          'The «Расходы» screen reads its header from the counter and its per-employee rows from the journal, so it now disagrees with itself. ' +
          'If it clears next run it was an in-flight request; if it persists, investigate — this check never auto-fixes.',
      );
      deps.recordAudit({
        actorRole: 'RECONCILER',
        action: 'billing.internal_drift',
        targetType: 'billing',
        targetId: status.month,
        metadata: {
          month: status.month,
          journalMicroUsd: journal.microUsd,
          counterMicroUsd: status.spentMicroUsd,
          driftMicroUsd,
          rows: journal.count,
        },
      });
    }
    return {
      month: status.month,
      journalMicroUsd: journal.microUsd,
      counterMicroUsd: status.spentMicroUsd,
      rows: journal.count,
      driftMicroUsd,
      drifted,
      checkedAt: now,
    };
  }

  /**
   * The key's own limit is a cliff, not a curve: when usage reaches it OpenRouter
   * disables the key and every model in the contour stops at once, mid-month, for
   * everybody. On the stand that limit does not refill (`limit_reset: null`) — it is a
   * LIFETIME cap — so it creeps up on you: at the observed burn it is months away and
   * then it is not. Nothing else watches it, so say it out loud while there is still
   * time to raise it.
   */
  function warnIfKeyBudgetIsRunningOut(key: OpenRouterKeyInfo): void {
    const remaining = key.limitRemainingUsd;
    if (remaining == null || key.limitUsd == null) {
      return;
    }
    const monthly = key.usageMonthlyUsd ?? 0;
    /* A limit that refills cannot «run out in N months» — only the current window can
     * be nearly spent. A limit that never refills is the one that creeps up on you, so
     * only there does the burn-rate projection mean anything. */
    const refills = key.limitReset != null;
    const monthsLeft = !refills && monthly > 0 ? remaining / monthly : Infinity;
    const lowShare = remaining <= key.limitUsd * KEY_BUDGET_WARN_RATIO;
    if (monthsLeft > KEY_BUDGET_WARN_MONTHS && !lowShare) {
      return;
    }
    const refill = key.limitReset ? `refills ${key.limitReset}` : 'does NOT refill (lifetime cap)';
    logger.error(
      `[billingReconcile] OpenRouter key budget is running out: $${remaining.toFixed(2)} left of $${key.limitUsd} (${refill}), ` +
        `burning $${monthly.toFixed(2)} this UTC month` +
        (Number.isFinite(monthsLeft)
          ? ` → about ${monthsLeft.toFixed(1)} month(s) of headroom`
          : '') +
        '. When it runs out OpenRouter disables the key and EVERY model stops contour-wide, mid-period. Raise it before then.',
    );
  }

  async function run(now: Date = new Date()): Promise<ReconcileReport> {
    /* Reading the key's usage is all the external comparison needs, and the contour key
     * can read its own. Requiring provisioning here is what left the stand with no
     * external check at all: it is the ONLY thing that can see spend which never
     * reached the ledger, and it was switched off by a credential nobody had set. */
    if (!deps.openrouter.canReadUsage) {
      return { configured: false, reason: 'no OpenRouter key available to read usage' };
    }
    if (isEarlyUtcMonth(now)) {
      return {
        configured: true,
        alerted: false,
        reason: `skipped: first ${EARLY_MONTH_SKIP_HOURS}h of the UTC month (usage_monthly boundary)`,
      };
    }
    try {
      const utcMonthStart = startOfUtcMonth(now);
      const [status, key, utcMonthJournal, firstSpendAt] = await Promise.all([
        deps.getCreditBillingStatus({
          poolMicroUsd: deps.poolMicroUsd,
          tenantId: deps.tenantId,
          anchorDay: deps.anchorDay,
          at: now,
        }),
        deps.openrouter.getKey(),
        deps.sumCreditSpendJournalRange({ from: utcMonthStart, to: now, tenantId: deps.tenantId }),
        deps.getFirstCreditSpendAt({ tenantId: deps.tenantId }),
      ]);

      /* Changing the fuse needs provisioning credentials; reading usage does not. With
       * only the contour key we still compare, we just cannot move the limit. */
      if (deps.openrouter.isConfigured) {
        await syncKeyLimit(status, key);
      }
      warnIfKeyBudgetIsRunningOut(key);

      /* Same invariant as the standalone check — reused so the two callers can never
       * drift apart in what they consider drift. `status` is already in hand, so this
       * costs one extra read at most. */
      const internal = await checkInternalDrift(now, status);
      const internalDriftMicroUsd = internal.driftMicroUsd;

      /* External: the journal over THIS UTC calendar month (matching OpenRouter's
       * usage_monthly window) vs the key's usage. Independent of the billing period. */
      const ledgerUsd = utcMonthJournal.microUsd / MICRO_USD_PER_USD;
      const openrouterUsd = key.usageMonthlyUsd;
      if (openrouterUsd == null) {
        return {
          configured: true,
          month: status.month,
          ledgerUsd,
          ledgerCredits: microUsdToCredits(utcMonthJournal.microUsd),
          journalMicroUsd: internal.journalMicroUsd,
          internalDriftMicroUsd,
          diffPercent: null,
          alerted: false,
          reason: 'OpenRouter did not return usage_monthly',
        };
      }

      const diffUsd = ledgerUsd - openrouterUsd;
      const base = Math.max(Math.abs(ledgerUsd), Math.abs(openrouterUsd));
      const ratio = base > 0 ? Math.abs(diffUsd) / base : 0;
      const diffPercent = base > 0 ? Math.round(ratio * 1000) / 10 : 0;
      /* The key's usage_monthly counts from the 1st; the ledger only counts from the
       * moment metering was switched on. In the month that happens the difference is
       * pre-metering spend, not lost spend — the two are indistinguishable here, and
       * this case is GUARANTEED at go-live. Report the numbers, hold the alert: from the
       * next UTC month both windows start together and drift means what it says.
       *
       * An EMPTY ledger is only innocent while the key has spent nothing either. Once it
       * shows real money against a ledger that has never recorded anything, that is the
       * reporter being down — the loudest possible symptom, not a reason to stay quiet. */
      const meteringStartedThisMonth = firstSpendAt != null && firstSpendAt >= utcMonthStart;
      const partialLedger =
        meteringStartedThisMonth || (firstSpendAt == null && openrouterUsd <= minAbsUsd);
      const shouldAlert = !partialLedger && ratio > threshold && Math.abs(diffUsd) > minAbsUsd;

      const report: ReconcileReport = {
        configured: true,
        month: status.month,
        ledgerCredits: microUsdToCredits(utcMonthJournal.microUsd),
        openrouterCredits: Math.round(openrouterUsd * 100),
        ledgerUsd,
        openrouterUsd,
        journalMicroUsd: internal.journalMicroUsd,
        internalDriftMicroUsd,
        diffPercent,
        alerted: shouldAlert,
        ...(partialLedger && {
          reason: meteringStartedThisMonth
            ? 'alert held: metering started mid-month — the difference includes spend from before it was counted'
            : 'alert held: nothing metered yet and the key has spent nothing either',
        }),
      };

      /* Always report the comparison, not only on drift: a silent reconciler is
       * indistinguishable from one that never ran, so «нет алерта» could never be
       * trusted as «леджер сходится с ключом». This one line is how an operator
       * verifies that Credits track the real OpenRouter key spend. */
      logger.info(
        `[billingReconcile] UTC-month ledger $${ledgerUsd.toFixed(6)} (${report.ledgerCredits} Cr, ${utcMonthJournal.count} rows) vs OpenRouter usage_monthly $${openrouterUsd.toFixed(6)} → diff ${diffPercent}% ($${diffUsd.toFixed(6)}); alert=${shouldAlert} (needs >${threshold * 100}% AND >$${minAbsUsd}${partialLedger ? ', HELD — ' + report.reason : ''}). Period ${status.month}: journal=${internal.journalMicroUsd}µ$ counter=${status.spentMicroUsd}µ$ drift=${internalDriftMicroUsd}µ$`,
      );

      /* Once per period, not once per run.
       *
       * The difference this reports does not clear on its own: a key can be spent
       * OUTSIDE the proxy — every `tools/` bench does exactly that — and such spend can
       * never reach the ledger, so the gap it opens stays for the rest of the UTC month.
       * Measured 20.08.2026: OpenRouter $4.388 against a ledger of $3.228 for the same
       * window, 26%, while the SAME day matched to $0.000003 of $0.2587. Alerting every
       * run would mail that difference daily until the month rolls over, and an alert
       * that arrives every day is an alert nobody opens — the failure mode this check
       * exists to prevent. */
      const alertClaimed =
        shouldAlert &&
        (deps.markCreditMonthNotified == null ||
          (await deps.markCreditMonthNotified({
            month: status.month,
            kind: 'reconcile',
            tenantId: deps.tenantId,
          })));
      report.alerted = alertClaimed;
      if (shouldAlert && !alertClaimed) {
        report.reason = 'already alerted for this period';
      }

      if (alertClaimed) {
        deps.recordAudit({
          action: 'billing.reconcile_alert',
          targetType: 'billing',
          targetId: status.month,
          metadata: {
            month: status.month,
            ledgerCredits: report.ledgerCredits ?? 0,
            openrouterCredits: report.openrouterCredits ?? 0,
            diffPercent: diffPercent ?? 0,
          },
        });
        await deps.sendAlert({
          kind: 'reconcile',
          month: status.month,
          ledgerUsd,
          openrouterUsd,
          diffPercent: diffPercent ?? 0,
        });
        logger.error(
          `[billingReconcile] ledger $${ledgerUsd.toFixed(6)} vs OpenRouter $${openrouterUsd.toFixed(6)} (${diffPercent}%). ` +
            'Either spend reported to the ledger was lost, or the key was used OUTSIDE the proxy — ' +
            'benches in tools/ call OpenRouter directly and can never appear in the ledger. ' +
            'Compare a single quiet day first: those windows match exactly when only proxy traffic ran.',
        );
      }

      return report;
    } catch (error) {
      logger.error('[billingReconcile] run failed:', error);
      return { configured: true, alerted: false, reason: 'reconcile failed — see server logs' };
    }
  }

  return { run, checkInternalDrift };
}
