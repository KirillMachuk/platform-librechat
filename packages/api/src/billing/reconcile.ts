import { logger, microUsdToCredits, MICRO_USD_PER_USD } from '@librechat/data-schemas';
import type { AuditLogInput, CreditBillingStatus } from '@librechat/data-schemas';
import type { OpenRouterManagement } from './openrouter';
import type { BillingAlert } from './types';

/** Alert when internal ledger vs OpenRouter drift exceeds ~3%… */
const DEFAULT_THRESHOLD_RATIO = 0.03;
/** …and at least this many dollars (early-month percentages are pure noise). */
const DEFAULT_MIN_ABS_USD = 1;

export interface ReconcileReport {
  configured: boolean;
  month?: string;
  ledgerCredits?: number;
  openrouterCredits?: number;
  /** Operator-facing dollar figures (never shown in the client UI). */
  ledgerUsd?: number;
  openrouterUsd?: number;
  diffPercent?: number | null;
  alerted?: boolean;
  reason?: string;
}

export interface BillingReconcilerDeps {
  openrouter: OpenRouterManagement;
  getCreditBillingStatus: (params: {
    poolMicroUsd: number;
    tenantId?: string;
  }) => Promise<CreditBillingStatus>;
  poolMicroUsd: number;
  tenantId?: string;
  sendAlert: (alert: BillingAlert) => Promise<void>;
  recordAudit: (event: AuditLogInput) => void;
  thresholdRatio?: number;
  minAbsUsd?: number;
}

/**
 * Compares the internal ledger's current-month spend with the OpenRouter key's
 * `usage_monthly`. Windows differ slightly by design — the ledger month is
 * Europe/Minsk (UTC+3) while OpenRouter's is UTC — so the boundary skew is up
 * to 3 hours of traffic; the 3% + $1 tolerance absorbs it.
 */
export function createBillingReconciler(deps: BillingReconcilerDeps): {
  run: () => Promise<ReconcileReport>;
} {
  const threshold = deps.thresholdRatio ?? DEFAULT_THRESHOLD_RATIO;
  const minAbsUsd = deps.minAbsUsd ?? DEFAULT_MIN_ABS_USD;

  async function run(): Promise<ReconcileReport> {
    if (!deps.openrouter.isConfigured) {
      return { configured: false, reason: 'management key / key hash not configured' };
    }
    try {
      const [status, key] = await Promise.all([
        deps.getCreditBillingStatus({ poolMicroUsd: deps.poolMicroUsd, tenantId: deps.tenantId }),
        deps.openrouter.getKey(),
      ]);
      const ledgerUsd = status.spentMicroUsd / MICRO_USD_PER_USD;
      const openrouterUsd = key.usageMonthlyUsd;
      if (openrouterUsd == null) {
        return {
          configured: true,
          month: status.month,
          ledgerUsd,
          ledgerCredits: microUsdToCredits(status.spentMicroUsd),
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
