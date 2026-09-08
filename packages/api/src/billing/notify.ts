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
    landedCostMultiplier?: number;
    tenantId?: string;
    anchorDay?: number;
  }) => Promise<CreditBillingStatus>;
  markCreditMonthNotified: (params: {
    month: string;
    kind: '80' | 'exhausted';
    tenantId?: string;
  }) => Promise<boolean>;
  poolMicroUsd: number;
  landedCostMultiplier: number;
  tenantId?: string;
  /** Service-period anchor day (1–31; defaults to 1). */
  anchorDay?: number;
  /**
   * Delivers the alert and answers how many recipients it reached; never throws.
   *
   * The count is not decoration. The claim below is taken BEFORE sending, so an alert
   * that reaches nobody would otherwise burn it and silence the notification for the
   * rest of the billing period — up to thirty days — for the two alerts the contract
   * actually promises the customer.
   */
  sendAlert: (alert: BillingAlert) => Promise<number | void>;
  /** Gives back a claim whose alert reached nobody, so a later spend can try again. */
  releaseCreditMonthAlert?: (params: {
    month: string;
    kind: '80' | 'exhausted';
    tenantId?: string;
  }) => Promise<boolean>;
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
/**
 * Sends, and hands the claim back if the mail reached nobody.
 *
 * A `sendAlert` that predates this contract returns `void`; that is treated as
 * "delivered", which keeps the old behaviour rather than releasing a claim on every
 * single send.
 */
async function deliverOrRelease(
  deps: BillingNotifierDeps,
  alert: BillingAlert,
  kind: '80' | 'exhausted',
  month: string,
): Promise<void> {
  const delivered = await deps.sendAlert(alert);
  if (delivered !== 0) {
    return;
  }
  const released =
    deps.releaseCreditMonthAlert != null &&
    (await deps.releaseCreditMonthAlert({ month, kind, tenantId: deps.tenantId }));
  logger[released ? 'warn' : 'error'](
    released
      ? `[billing] alert "${alert.kind}" reached nobody — claim released, a later spend will retry`
      : `[billing] alert "${alert.kind}" reached nobody AND the claim could not be released — this period will not warn again`,
  );
}

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
    await deliverOrRelease(deps, alert, '80', result.month);
  }

  async function notifyExhausted(result: RecordCreditSpendResult): Promise<void> {
    // The pool is spent — whether we are truly exhausted depends on packages.
    const status = await deps.getCreditBillingStatus({
      poolMicroUsd: deps.poolMicroUsd,
      landedCostMultiplier: deps.landedCostMultiplier,
      tenantId: deps.tenantId,
      anchorDay: deps.anchorDay,
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
    await deliverOrRelease(deps, alert, 'exhausted', result.month);
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
