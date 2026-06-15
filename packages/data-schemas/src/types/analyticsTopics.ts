import type { Document, Types } from 'mongoose';

/**
 * Topic clustering (AI usage analytics P2). Three tenant-scoped collections cache
 * the result of a clustering RUN so the admin can see "what employees do with AI"
 * grouped into themes — without re-running the (local) embedding + clustering on
 * every screen open. See ADR-0001 §8 D7.
 *
 * - AnalyticsRun        — one clustering pass over a time window (lifecycle + lease).
 * - AnalyticsTopic      — one discovered theme in a run (label, keywords, size).
 * - AnalyticsAssignment — one conversation placed into a theme (for drill-in/slicing).
 */

export type AnalyticsRunStatus = 'pending' | 'running' | 'done' | 'failed';
export type AnalyticsRunTrigger = 'scheduled' | 'manual';

export interface IAnalyticsRun extends Document {
  tenantId?: string;
  status: AnalyticsRunStatus;
  /** What kicked the run off: the periodic schedule or an admin "generate now". */
  trigger: AnalyticsRunTrigger;
  /** Conversation window clustered (inclusive start, exclusive end). */
  windowStart?: Date;
  windowEnd?: Date;
  /** Lease expiry for the atomic claim — guarantees one runner per run across replicas. */
  leaseExpiresAt?: Date;
  attempts: number;
  startedAt?: Date;
  finishedAt?: Date;
  /** Summary stats (filled on completion). */
  conversationCount?: number;
  topicCount?: number;
  assignedCount?: number;
  /** Conversations the clusterer left unassigned (e.g. HDBSCAN noise). */
  noiseCount?: number;
  error?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IAnalyticsTopic extends Document {
  tenantId?: string;
  runId: Types.ObjectId;
  /** Cluster id within the run (the clusterer's label). */
  topicKey: number;
  /** Human-readable theme name (LLM-generated over anonymized text); absent until labeled. */
  label?: string;
  /** Distinctive terms for the cluster (c-TF-IDF); also the labeling input. */
  keywords: string[];
  /** Conversations in this cluster. */
  size: number;
  /** Share of clustered conversations (0..1). */
  share: number;
  /** A few representative conversation ids for drill-in / labeling. */
  representativeConversationIds: string[];
  /** Cluster centroid (local embedding space, 1024-dim) for incremental assignment. */
  centroid?: number[];
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IAnalyticsAssignment extends Document {
  tenantId?: string;
  runId: Types.ObjectId;
  conversationId: string;
  topicKey: number;
  /** Conversation author — enables the per-department slice (groups). */
  userId?: string;
  /** Conversation timestamp — enables the within-run period slice. */
  conversationCreatedAt?: Date;
  /** Similarity/confidence of the assignment (0..1), when the clusterer provides it. */
  score?: number;
  createdAt?: Date;
}

/** One conversation handed to the clusterer: its title + first employee turns. */
export interface ClusteringInput {
  conversationId: string;
  userId?: string;
  title?: string;
  /** Title + first user prompts, joined — the unit of clustering. */
  text: string;
  createdAt?: Date;
}
