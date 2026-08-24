import { Schema } from 'mongoose';
import type * as t from '~/types';

/**
 * Tenant credit ledger (billing «Кредиты», 1 Credit = $0.01 of commercial spend).
 * All money fields are integer micro-USD (1e-6 USD) — see `types/credit.ts`.
 *
 * Three collections:
 *  - `creditmonths`   — one doc per billing period (rolling «month of service»,
 *                       Europe/Minsk): the included pool counter.
 *  - `creditpackages` — immutable lots: purchased packages and manual operator
 *                       adjustments (signed — refunds and clawbacks).
 *  - `creditspends`   — per-request journal of actual cost (reconciliation raw material).
 */

export const creditMonthSchema: Schema<t.ICreditMonth> = new Schema<t.ICreditMonth>(
  {
    tenantId: { type: String, index: true },
    /** Billing-period key = the Minsk period-start date `YYYY-MM-DD` (`YYYY-MM-01` when anchorDay=1). */
    month: { type: String, required: true },
    /** Pool size snapshot at period creation — a mid-period config change does not rewrite history. */
    poolMicroUsd: { type: Number, required: true },
    /** Payment/FX uplift snapshot. Legacy documents omit it and are read as 1. */
    landedCostMultiplier: { type: Number, default: 1 },
    spentMicroUsd: { type: Number, default: 0 },
    requestCount: { type: Number, default: 0 },
    /** Period bounds `[start, end)` (instants) captured at creation — for display only. */
    periodStart: { type: Date, default: null },
    periodEnd: { type: Date, default: null },
    notified80At: { type: Date, default: null },
    notifiedExhaustedAt: { type: Date, default: null },
    /** Set once per period when the OpenRouter comparison alerted — the drift it reports
     *  persists for the rest of the period, so without this the alert repeats daily. */
    notifiedReconcileAt: { type: Date, default: null },
    /** WHICH UTC month that alert was about (`YYYY-MM`). The comparison window is the UTC
     *  calendar month while this document is keyed by the billing period; without naming
     *  the window, a period that spans two UTC months silently swallows the second one. */
    notifiedReconcileUtcMonth: { type: String, default: null },
  },
  { timestamps: true },
);

creditMonthSchema.index({ tenantId: 1, month: 1 }, { unique: true });

export const creditPackageSchema: Schema<t.ICreditPackage> = new Schema<t.ICreditPackage>(
  {
    tenantId: { type: String, index: true },
    /** Lots written before adjustments existed carry no `kind` — readers treat it as `package`. */
    kind: { type: String, enum: ['package', 'adjustment'], default: 'package' },
    credits: { type: Number, required: true },
    microUsd: { type: Number, required: true },
    comment: { type: String },
    invoiceRef: { type: String },
    addedByEmail: { type: String },
    addedById: { type: Schema.Types.ObjectId, ref: 'User' },
    idempotencyKey: { type: String, required: true },
  },
  { timestamps: true },
);

creditPackageSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true });
creditPackageSchema.index({ tenantId: 1, createdAt: 1 });

export const creditSpendSchema: Schema<t.ICreditSpend> = new Schema<t.ICreditSpend>(
  {
    tenantId: { type: String, index: true },
    month: { type: String, required: true },
    /** Raw OpenRouter cost — never uplifted, used for provider reconciliation. */
    microUsd: { type: Number, required: true },
    /** Client-facing commercial spend. Legacy rows omit it and are read as raw cost. */
    billableMicroUsd: { type: Number },
    landedCostMultiplier: { type: Number },
    model: { type: String },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    /** Upstream response id — unique so reporter retries can never double-count. */
    sourceId: { type: String, index: { unique: true, sparse: true } },
    context: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

creditSpendSchema.index({ tenantId: 1, month: 1 });
/**
 * The journal is reconciliation raw material, not permanent history: expire rows
 * after 400 days (> a full year plus a month boundary) so the collection stays
 * bounded without a cron. Safe against every reader — the internal journal↔counter
 * check and the OpenRouter reconcile only ever touch the *current* Minsk month, so
 * TTL never removes a row they depend on.
 */
creditSpendSchema.index({ createdAt: 1 }, { expireAfterSeconds: 400 * 24 * 60 * 60 });
