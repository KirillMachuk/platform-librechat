import type { Document, Types } from 'mongoose';

/**
 * Tenant credit ledger types (billing «Кредиты»).
 * Money model & unit converters live in `~/common/credit`:
 *   1 Credit = $0.01 of actual OpenRouter cost; storage unit = integer micro-USD.
 */

/** One document per calendar month (Europe/Minsk) per tenant: the included pool. */
export interface ICreditMonth extends Document {
  tenantId?: string;
  /** Calendar month key in Europe/Minsk, e.g. `2026-07`. */
  month: string;
  /** Pool size snapshot taken when the month document is created (µ$). */
  poolMicroUsd: number;
  /** Actual OpenRouter cost attributed to this month (µ$), pool + package overflow. */
  spentMicroUsd: number;
  requestCount: number;
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
  /** Pool size to snapshot if this spend creates the month document (µ$). */
  poolMicroUsd: number;
  tenantId?: string;
  model?: string;
  userId?: string;
  sourceId?: string;
  context?: string;
  /** Spend timestamp (defaults to now); determines the Minsk month. */
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
  month: string;
  poolMicroUsd: number;
  spentMicroUsd: number;
  requestCount: number;
  purchasedMicroUsd: number;
  /** Total package spend so far = Σ over months of max(0, spent − pool). */
  packageSpentMicroUsd: number;
  /** May be ≤ 0 after a boundary overrun (concurrent requests) — clamp for display. */
  packageRemainingMicroUsd: number;
  /** Soft block: monthly pool exhausted AND no package credits remain. */
  blocked: boolean;
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
