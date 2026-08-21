/** Operator alert emitted by the billing notifier / reconciler. */
export type BillingAlertKind = 'pool80' | 'exhausted' | 'reconcile';

export interface BillingAlert {
  kind: BillingAlertKind;
  /** Europe/Minsk billing-period key — the period START DATE, e.g. `2026-08-15`
   *  (`YYYY-MM-01` when the anchor is the 1st). Printed in the alert's subject line. */
  month: string;
  /** Whole display Credits (never $ — the client UI must stay dollar-free). */
  spentCredits?: number;
  poolCredits?: number;
  percentUsed?: number;
  packageRemainingCredits?: number;
  /** Reconcile-only fields (operator-facing, may carry USD). */
  ledgerUsd?: number;
  openrouterUsd?: number;
  diffPercent?: number;
}
