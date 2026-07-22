import {
  logger,
  microUsdToCredits,
  servicePeriodKey,
  MICRO_USD_PER_USD,
} from '@librechat/data-schemas';
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

  async function run(now: Date = new Date()): Promise<ReconcileReport> {
    if (!deps.openrouter.isConfigured) {
      return { configured: false, reason: 'management key / key hash not configured' };
    }
    if (isEarlyUtcMonth(now)) {
      return {
        configured: true,
        alerted: false,
        reason: `skipped: first ${EARLY_MONTH_SKIP_HOURS}h of the UTC month (usage_monthly boundary)`,
      };
    }
    try {
      const periodKey = servicePeriodKey(now, deps.anchorDay);
      const utcMonthStart = startOfUtcMonth(now);
      const [status, key, periodJournal, utcMonthJournal, firstSpendAt] = await Promise.all([
        deps.getCreditBillingStatus({
          poolMicroUsd: deps.poolMicroUsd,
          tenantId: deps.tenantId,
          anchorDay: deps.anchorDay,
          at: now,
        }),
        deps.openrouter.getKey(),
        deps.sumCreditSpendJournal({ month: periodKey, tenantId: deps.tenantId }),
        deps.sumCreditSpendJournalRange({ from: utcMonthStart, to: now, tenantId: deps.tenantId }),
        deps.getFirstCreditSpendAt({ tenantId: deps.tenantId }),
      ]);

      await syncKeyLimit(status, key);

      /* Internal consistency: the current period's per-request journal sum must equal
       * the period counter — both are written from the same rounded µ$ value. Persistent
       * drift means a lost counter increment (a crash between the journal write and the
       * $inc). We surface it in logs and the report, but never auto-fix it. */
      const internalDriftMicroUsd = periodJournal.microUsd - status.spentMicroUsd;
      if (Math.abs(internalDriftMicroUsd) > INTERNAL_DRIFT_TOLERANCE_MICRO_USD) {
        logger.error(
          `[billingReconcile] INTERNAL drift for period ${status.month}: journal=${periodJournal.microUsd}µ$ (${periodJournal.count} rows) vs period counter=${status.spentMicroUsd}µ$ (Δ=${internalDriftMicroUsd}µ$). ` +
            'Likely a lost counter increment (crash between the journal write and the $inc). ' +
            'If it clears next run it was an in-flight request; if it persists, investigate — reconcile does not auto-fix.',
        );
      }

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
          journalMicroUsd: periodJournal.microUsd,
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
        journalMicroUsd: periodJournal.microUsd,
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
        `[billingReconcile] UTC-month ledger $${ledgerUsd.toFixed(6)} (${report.ledgerCredits} Cr, ${utcMonthJournal.count} rows) vs OpenRouter usage_monthly $${openrouterUsd.toFixed(6)} → diff ${diffPercent}% ($${diffUsd.toFixed(6)}); alert=${shouldAlert} (needs >${threshold * 100}% AND >$${minAbsUsd}${partialLedger ? ', HELD — ' + report.reason : ''}). Period ${status.month}: journal=${periodJournal.microUsd}µ$ counter=${status.spentMicroUsd}µ$ drift=${internalDriftMicroUsd}µ$`,
      );

      if (shouldAlert) {
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
      }

      return report;
    } catch (error) {
      logger.error('[billingReconcile] run failed:', error);
      return { configured: true, alerted: false, reason: 'reconcile failed — see server logs' };
    }
  }

  return { run };
}
