import { logger, microUsdToCredits } from '@librechat/data-schemas';
import type {
  AuditLogInput,
  CreditBillingStatus,
  RecordCreditSpendResult,
} from '@librechat/data-schemas';
import type { BillingAlert } from './types';

export interface BillingNotifierDeps {
  getCreditBillingStatus: (params: {
    poolMicroUsd: number;
    tenantId?: string;
  }) => Promise<CreditBillingStatus>;
  markCreditMonthNotified: (params: {
    month: string;
    kind: '80' | 'exhausted';
    tenantId?: string;
  }) => Promise<boolean>;
  poolMicroUsd: number;
  tenantId?: string;
  /** Delivers the alert (email/whatever the stack has); errors are logged, not thrown. */
  sendAlert: (alert: BillingAlert) => Promise<void>;
  /** Fire-and-forget audit recorder. */
  recordAudit: (event: AuditLogInput) => void;
}

/**
 * Turns spend results into the two contract notifications:
 *  - ~80% of the monthly pool consumed;
 *  - pool AND packages fully exhausted (the soft block engaged).
 * The month document's flags make each fire exactly once per month; a package
 * top-up re-arms the exhaustion flag (see `addCreditPackage`).
 */
export function createBillingNotifier(deps: BillingNotifierDeps): {
  handleSpendResult: (result: RecordCreditSpendResult) => Promise<void>;
} {
  async function notifyPool80(result: RecordCreditSpendResult): Promise<void> {
    const won = await deps.markCreditMonthNotified({
      month: result.month,
      kind: '80',
      tenantId: deps.tenantId,
    });
    if (!won) {
      return;
    }
    const poolCredits = microUsdToCredits(result.poolMicroUsd);
    const spentCredits = microUsdToCredits(result.spentAfterMicroUsd);
    const percentUsed = Math.round((result.spentAfterMicroUsd / result.poolMicroUsd) * 100);
    const alert: BillingAlert = {
      kind: 'pool80',
      month: result.month,
      spentCredits,
      poolCredits,
      percentUsed,
    };
    deps.recordAudit({
      action: 'billing.threshold_80',
      targetType: 'billing',
      targetId: result.month,
      metadata: { month: result.month, spentCredits, poolCredits, percentUsed },
    });
    await deps.sendAlert(alert);
  }

  async function notifyExhausted(result: RecordCreditSpendResult): Promise<void> {
    // The pool is spent — whether we are truly exhausted depends on packages.
    const status = await deps.getCreditBillingStatus({
      poolMicroUsd: deps.poolMicroUsd,
      tenantId: deps.tenantId,
    });
    if (!status.blocked) {
      return;
    }
    const won = await deps.markCreditMonthNotified({
      month: result.month,
      kind: 'exhausted',
      tenantId: deps.tenantId,
    });
    if (!won) {
      return;
    }
    const poolCredits = microUsdToCredits(status.poolMicroUsd);
    const spentCredits = microUsdToCredits(status.spentMicroUsd);
    const alert: BillingAlert = {
      kind: 'exhausted',
      month: result.month,
      spentCredits,
      poolCredits,
      packageRemainingCredits: Math.max(0, microUsdToCredits(status.packageRemainingMicroUsd)),
    };
    deps.recordAudit({
      action: 'billing.exhausted',
      targetType: 'billing',
      targetId: result.month,
      metadata: { month: result.month, spentCredits, poolCredits },
    });
    await deps.sendAlert(alert);
  }

  /** Never throws — notification failures must not affect spend recording. */
  async function handleSpendResult(result: RecordCreditSpendResult): Promise<void> {
    if (result.duplicate) {
      return;
    }
    try {
      if (result.crossed80 && result.notified80At == null) {
        await notifyPool80(result);
      }
      if (result.spentAfterMicroUsd >= result.poolMicroUsd && result.notifiedExhaustedAt == null) {
        await notifyExhausted(result);
      }
    } catch (error) {
      logger.error('[billingNotifier] failed to process spend result:', error);
    }
  }

  return { handleSpendResult };
}
