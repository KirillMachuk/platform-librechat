/** Operator alert emitted by the billing notifier / reconciler. */
export type BillingAlertKind = 'pool80' | 'exhausted' | 'reconcile';

export interface BillingAlert {
  kind: BillingAlertKind;
  /** Europe/Minsk month key, e.g. `2026-07`. */
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
