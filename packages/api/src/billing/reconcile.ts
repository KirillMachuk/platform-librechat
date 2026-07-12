import {
  logger,
  microUsdToCredits,
  minskMonthKey,
  MICRO_USD_PER_USD,
} from '@librechat/data-schemas';
import type { AuditLogInput, CreditBillingStatus } from '@librechat/data-schemas';
import type { OpenRouterManagement } from './openrouter';
import type { BillingAlert } from './types';

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
/** Skip the OpenRouter comparison during the first hours of a fresh Minsk month. */
const EARLY_MONTH_SKIP_HOURS = 6;

/**
 * Europe/Minsk (UTC+3, no DST) day-of-month and hour for a timestamp. The ledger's
 * month resets on the Minsk 1st while OpenRouter's `usage_monthly` runs on UTC, so
 * right after the boundary the ledger reads ~0 and OpenRouter still holds the old
 * window — any comparison there is noise and is skipped.
 */
const MINSK_DAYHOUR_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Minsk',
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
});

function isEarlyMinskMonth(at: Date): boolean {
  const parts = MINSK_DAYHOUR_FMT.formatToParts(at);
  const day = Number(parts.find((p) => p.type === 'day')?.value);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  return day === 1 && hour < EARLY_MONTH_SKIP_HOURS;
}

export interface ReconcileReport {
  configured: boolean;
  month?: string;
  ledgerCredits?: number;
  openrouterCredits?: number;
  /** Operator-facing dollar figures (never shown in the client UI). */
  ledgerUsd?: number;
  openrouterUsd?: number;
  /** Internal check (µ$): journal sum and its drift from the month counter — should converge to ~0. */
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
    at?: Date;
  }) => Promise<CreditBillingStatus>;
  /** Journal sum for a month — reconciled against the month counter (internal check). */
  sumCreditSpendJournal: (params: {
    month: string;
    tenantId?: string;
  }) => Promise<{ microUsd: number; count: number }>;
  poolMicroUsd: number;
  tenantId?: string;
  sendAlert: (alert: BillingAlert) => Promise<void>;
  recordAudit: (event: AuditLogInput) => void;
  thresholdRatio?: number;
  minAbsUsd?: number;
}

/**
 * Two reconciliations in one pass:
 *  1. Internal — the per-request journal sum vs the month counter (catches a lost
 *     counter increment); logged, never auto-fixed.
 *  2. External — the ledger's current-month spend vs the OpenRouter key's
 *     `usage_monthly`. Windows differ by design (ledger = Europe/Minsk UTC+3,
 *     OpenRouter = UTC) so the boundary skew is up to 3h of traffic; the 3% + $1
 *     tolerance absorbs it, and the first few hours of a new Minsk month are
 *     skipped outright (the ledger has reset while OpenRouter's window has not).
 */
export function createBillingReconciler(deps: BillingReconcilerDeps): {
  run: (now?: Date) => Promise<ReconcileReport>;
} {
  const threshold = deps.thresholdRatio ?? DEFAULT_THRESHOLD_RATIO;
  const minAbsUsd = deps.minAbsUsd ?? DEFAULT_MIN_ABS_USD;

  async function run(now: Date = new Date()): Promise<ReconcileReport> {
    if (!deps.openrouter.isConfigured) {
      return { configured: false, reason: 'management key / key hash not configured' };
    }
    if (isEarlyMinskMonth(now)) {
      return {
        configured: true,
        alerted: false,
        reason: `skipped: first ${EARLY_MONTH_SKIP_HOURS}h of the Minsk month (boundary window)`,
      };
    }
    try {
      const month = minskMonthKey(now);
      const [status, key, journal] = await Promise.all([
        deps.getCreditBillingStatus({
          poolMicroUsd: deps.poolMicroUsd,
          tenantId: deps.tenantId,
          at: now,
        }),
        deps.openrouter.getKey(),
        deps.sumCreditSpendJournal({ month, tenantId: deps.tenantId }),
      ]);

      /* Internal consistency: the per-request journal sum must equal the month
       * counter — both are written from the same rounded µ$ value. Persistent drift
       * means a lost counter increment (a crash between the journal write and the
       * $inc). We surface it in logs and the report, but never auto-fix it. */
      const internalDriftMicroUsd = journal.microUsd - status.spentMicroUsd;
      if (Math.abs(internalDriftMicroUsd) > INTERNAL_DRIFT_TOLERANCE_MICRO_USD) {
        logger.error(
          `[billingReconcile] INTERNAL drift for ${status.month}: journal=${journal.microUsd}µ$ (${journal.count} rows) vs month counter=${status.spentMicroUsd}µ$ (Δ=${internalDriftMicroUsd}µ$). ` +
            'Likely a lost counter increment (crash between the journal write and the $inc). ' +
            'If it clears next run it was an in-flight request; if it persists, investigate — reconcile does not auto-fix.',
        );
      }

      const ledgerUsd = status.spentMicroUsd / MICRO_USD_PER_USD;
      const openrouterUsd = key.usageMonthlyUsd;
      if (openrouterUsd == null) {
        return {
          configured: true,
          month: status.month,
          ledgerUsd,
          ledgerCredits: microUsdToCredits(status.spentMicroUsd),
          journalMicroUsd: journal.microUsd,
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
      const shouldAlert = ratio > threshold && Math.abs(diffUsd) > minAbsUsd;

      const report: ReconcileReport = {
        configured: true,
        month: status.month,
        ledgerCredits: microUsdToCredits(status.spentMicroUsd),
        openrouterCredits: Math.round(openrouterUsd * 100),
        ledgerUsd,
        openrouterUsd,
        journalMicroUsd: journal.microUsd,
        internalDriftMicroUsd,
        diffPercent,
        alerted: shouldAlert,
      };

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
