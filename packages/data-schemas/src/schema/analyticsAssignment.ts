import { Schema } from 'mongoose';
import type * as t from '~/types';

/** One conversation placed into a theme — powers drill-in and the period/department slices. */
const analyticsAssignmentSchema = new Schema<t.IAnalyticsAssignment>(
  {
    tenantId: { type: String, index: true },
    runId: { type: Schema.Types.ObjectId, ref: 'AnalyticsRun', required: true },
    conversationId: { type: String, required: true },
    topicKey: { type: Number, required: true },
    userId: { type: String },
    conversationCreatedAt: { type: Date },
    score: { type: Number },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// One assignment per (run, conversation) — keeps the results write idempotent.
analyticsAssignmentSchema.index({ runId: 1, conversationId: 1 }, { unique: true });
// Drill-in: conversations of a theme, newest first.
analyticsAssignmentSchema.index({ runId: 1, topicKey: 1, conversationCreatedAt: -1 });
// Department slice: map assignments to employees (→ groups).
analyticsAssignmentSchema.index({ tenantId: 1, runId: 1, userId: 1 });

export default analyticsAssignmentSchema;
