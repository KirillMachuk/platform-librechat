import { Schema } from 'mongoose';
import type * as t from '~/types';

/** One discovered theme within a run: its label, distinctive terms, size and centroid. */
const analyticsTopicSchema = new Schema<t.IAnalyticsTopic>(
  {
    tenantId: { type: String, index: true },
    runId: { type: Schema.Types.ObjectId, ref: 'AnalyticsRun', required: true },
    topicKey: { type: Number, required: true },
    label: { type: String },
    keywords: { type: [String], default: [] },
    size: { type: Number, required: true, default: 0 },
    share: { type: Number, required: true, default: 0 },
    representativeConversationIds: { type: [String], default: [] },
    centroid: { type: [Number], default: undefined },
  },
  { timestamps: true },
);

// One topic row per (run, cluster id) — makes the results upsert idempotent.
analyticsTopicSchema.index({ runId: 1, topicKey: 1 }, { unique: true });
// Largest themes first within a run (the distribution view).
analyticsTopicSchema.index({ tenantId: 1, runId: 1, size: -1 });

export default analyticsTopicSchema;
