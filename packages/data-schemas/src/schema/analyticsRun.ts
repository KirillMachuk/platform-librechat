import { Schema } from 'mongoose';
import type * as t from '~/types';

/**
 * One topic-clustering pass over a conversation window. Carries its own lifecycle
 * and a lease so exactly one worker runs a given run across replicas (claimed via
 * an atomic findOneAndUpdate, mirroring the file embed worker).
 */
const analyticsRunSchema = new Schema<t.IAnalyticsRun>(
  {
    tenantId: { type: String, index: true },
    status: {
      type: String,
      enum: ['pending', 'running', 'done', 'failed'],
      required: true,
      default: 'pending',
      index: true,
    },
    trigger: {
      type: String,
      enum: ['scheduled', 'manual'],
      required: true,
      default: 'scheduled',
    },
    windowStart: { type: Date },
    windowEnd: { type: Date },
    leaseExpiresAt: { type: Date },
    attempts: { type: Number, default: 0 },
    startedAt: { type: Date },
    finishedAt: { type: Date },
    conversationCount: { type: Number },
    topicCount: { type: Number },
    assignedCount: { type: Number },
    noiseCount: { type: Number },
    error: { type: String },
  },
  { timestamps: true },
);

// Latest run per tenant (the read path always wants the newest done run).
analyticsRunSchema.index({ tenantId: 1, createdAt: -1 });
// Claim scan: pick the next claimable run (pending, or a running lease that expired).
analyticsRunSchema.index({ status: 1, leaseExpiresAt: 1 });

export default analyticsRunSchema;
