import { Schema } from 'mongoose';
import type * as t from '~/types';

/**
 * Append-only audit log: a single "who — what — when" feed.
 * No update/delete methods are exposed; entries are immutable once written.
 */
const auditLogSchema: Schema<t.IAuditLog> = new Schema<t.IAuditLog>(
  {
    tenantId: { type: String, index: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    actorEmail: String,
    actorRole: String,
    action: { type: String, required: true, index: true },
    targetType: String,
    targetId: { type: String, index: true },
    conversationId: { type: String, index: true },
    messageId: String,
    model: String,
    tokens: { input: Number, output: Number, total: Number },
    ip: String,
    userAgent: String,
    outcome: {
      type: String,
      enum: ['success', 'failure', 'unknown'],
      required: true,
      default: 'success',
    },
    metadata: Schema.Types.Mixed,
    sourceId: { type: String, index: { unique: true, sparse: true } },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

/**
 * Every read sorts by `createdAt` descending. The compound indexes below only
 * serve a query that also constrains their leading field, so an unfiltered page
 * — the admin panel's default view, and every page of an export — would scan
 * the collection and sort in memory, which Mongo aborts past 32 MB.
 */
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ tenantId: 1, createdAt: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

/**
 * Retention. Append-only means entries are never rewritten — it does not mean
 * they are kept forever, and one row per model call makes "forever" a growing
 * problem on a single-VM deployment. A year plus a month covers any audit that
 * asks for "the last calendar year" without a cron to run.
 *
 * MongoDB fixes `expireAfterSeconds` when the index is built: changing the
 * number here does not move an index that already exists. To change retention,
 * drop `createdAt_1` and restart so it is rebuilt with the new value.
 */
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 400 * 24 * 60 * 60 });

export default auditLogSchema;
