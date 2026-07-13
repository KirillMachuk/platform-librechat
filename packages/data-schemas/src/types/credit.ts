import type { Document, Types } from 'mongoose';

/**
 * Tenant credit ledger types (billing «Кредиты»).
 * Money model & unit converters live in `~/common/credit`:
 *   1 Credit = $0.01 of actual OpenRouter cost; storage unit = integer micro-USD.
 */

/** One document per billing period (rolling «month of service», Europe/Minsk) per tenant. */
export interface ICreditMonth extends Document {
  tenantId?: string;
  /** Period key = the Minsk period-start date `YYYY-MM-DD` (`YYYY-MM-01` when anchorDay=1). */
  month: string;
  /** Pool size snapshot taken when the period document is created (µ$). */
  poolMicroUsd: number;
  /** Actual OpenRouter cost attributed to this period (µ$), pool + package overflow. */
  spentMicroUsd: number;
  requestCount: number;
  /** Period start instant (inclusive) — captured at creation, for display. */
  periodStart?: Date | null;
  /** Period end instant (exclusive = next period start) — captured at creation, for display. */
  periodEnd?: Date | null;
  /** Set once when the ~80% pool notification is sent (single-winner). */
  notified80At?: Date | null;
  /** Set once when the «pool + packages exhausted» notification is sent; reset on package add. */
  notifiedExhaustedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

/** A purchased credit package (immutable lot; needed for акты/refunds). */
export interface ICreditPackage extends Document {
  tenantId?: string;
  /** Package size in whole Credits (5 000 / 10 000 / 30 000). */
  credits: number;
  /** Same amount in µ$ (credits × 10 000). */
  microUsd: number;
  /** Operator comment / invoice number. */
  comment?: string;
  invoiceRef?: string;
  addedByEmail?: string;
  addedById?: Types.ObjectId;
  /** Client-generated key making the add operation idempotent (double-click safe). */
  idempotencyKey: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Per-request spend journal row (actual cost; raw material for reconciliation). */
export interface ICreditSpend extends Document {
  tenantId?: string;
  /** Month key the spend was attributed to (Europe/Minsk). */
  month: string;
  microUsd: number;
  model?: string;
  userId?: Types.ObjectId;
  /** Upstream response id (OpenRouter generation id) — dedupes reporter retries. */
  sourceId?: string;
  /** Free-form origin marker (e.g. `chat`). */
  context?: string;
  createdAt?: Date;
}

export interface RecordCreditSpendInput {
  /** Cost of one request in µ$ (already rounded to integer). */
  microUsd: number;
  /** Pool size to snapshot if this spend creates the period document (µ$). */
  poolMicroUsd: number;
  tenantId?: string;
  model?: string;
  userId?: string;
  sourceId?: string;
  context?: string;
  /** Service-period anchor day (1–31; defaults to 1 = calendar month). */
  anchorDay?: number;
  /** Spend timestamp (defaults to now); determines the billing period. */
  at?: Date;
}

export interface RecordCreditSpendResult {
  /** True when `sourceId` was already journaled — month was NOT incremented again. */
  duplicate: boolean;
  month: string;
  poolMicroUsd: number;
  spentBeforeMicroUsd: number;
  spentAfterMicroUsd: number;
  /** This spend crossed the ~80%-of-pool threshold (fire the notification check). */
  crossed80: boolean;
  /** This spend crossed the pool boundary (pool just ran out). */
  crossedPool: boolean;
  /** Month notification flags as of this write — lets the notifier skip redundant reads. */
  notified80At?: Date | null;
  notifiedExhaustedAt?: Date | null;
}

export interface CreditBillingStatus {
  /** Period key = the Minsk period-start date `YYYY-MM-DD`. */
  month: string;
  poolMicroUsd: number;
  spentMicroUsd: number;
  requestCount: number;
  purchasedMicroUsd: number;
  /** Total package spend so far = Σ over periods of max(0, spent − pool). */
  packageSpentMicroUsd: number;
  /** May be ≤ 0 after a boundary overrun (concurrent requests) — clamp for display. */
  packageRemainingMicroUsd: number;
  /** Soft block: the period pool is exhausted AND no package credits remain. */
  blocked: boolean;
  /** Period bounds `[start, end)` — for display («период 15 июля — 14 августа»). */
  periodStart?: Date | null;
  periodEnd?: Date | null;
  notified80At?: Date | null;
  notifiedExhaustedAt?: Date | null;
}

export interface AddCreditPackageInput {
  credits: number;
  comment?: string;
  invoiceRef?: string;
  addedByEmail?: string;
  addedById?: string;
  idempotencyKey: string;
  tenantId?: string;
  /** Service-period anchor day (1–31; defaults to 1) — which period's exhausted flag to re-arm. */
  anchorDay?: number;
  at?: Date;
}

export interface AddCreditPackageResult {
  /** False when the idempotency key already existed (replay — nothing was added). */
  created: boolean;
  package: ICreditPackage;
}

/** A lot with its FIFO-derived remaining amount (oldest lots are drained first). */
export interface CreditPackageWithRemaining {
  id: string;
  credits: number;
  microUsd: number;
  remainingMicroUsd: number;
  comment?: string;
  invoiceRef?: string;
  addedByEmail?: string;
  createdAt?: Date;
}
