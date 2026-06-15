import { logger } from '@librechat/data-schemas';
import type { IAnalyticsRun, ClusteringInput, AnalyticsRunTrigger } from '@librechat/data-schemas';

/** One conversation as sent to the topics service (createdAt as an opaque ISO string). */
export interface ClusterConversationInput {
  conversationId: string;
  text: string;
  userId?: string;
  createdAt?: string;
}

/** Shape returned by the topics service `/cluster`. */
export interface ClusterResult {
  topics: Array<{
    topicKey: number;
    keywords: string[];
    size: number;
    share: number;
    representativeConversationIds: string[];
    centroid?: number[];
    /** Human-readable name — absent from the service response; filled by the labeler. */
    label?: string;
  }>;
  assignments: Array<{
    conversationId: string;
    topicKey: number;
    userId?: string;
    conversationCreatedAt?: string;
    score?: number;
  }>;
  stats: { conversations: number; topics: number; assigned: number; noise: number };
}

export interface TopicClustererDeps {
  assembleConversationsForClustering: (
    filter: { tenantId?: string; from?: Date; to?: Date },
    options: { limit?: number; maxUserTurns?: number },
  ) => Promise<ClusteringInput[]>;
  /** Calls the (local, sovereign) topics service to embed + cluster the conversations. */
  clusterConversations: (conversations: ClusterConversationInput[]) => Promise<ClusterResult>;
  /** Creates the run already `running` with a lease (see methods.startAnalyticsRun). */
  startAnalyticsRun: (input: {
    tenantId?: string;
    trigger?: AnalyticsRunTrigger;
    windowStart?: Date;
    windowEnd?: Date;
    leaseMs: number;
  }) => Promise<IAnalyticsRun>;
  /**
   * Returns the run currently holding the tenant's slot (pending/running with a
   * live lease) or null — used to dedup overlapping triggers before starting.
   */
  getActiveAnalyticsRun: (tenantId?: string) => Promise<IAnalyticsRun | null>;
  saveRunResults: (
    runId: unknown,
    topics: ClusterResult['topics'],
    assignments: Array<{
      conversationId: string;
      topicKey: number;
      userId?: string;
      conversationCreatedAt?: Date;
      score?: number;
    }>,
  ) => Promise<void>;
  completeAnalyticsRun: (
    runId: unknown,
    stats: {
      conversationCount?: number;
      topicCount?: number;
      assignedCount?: number;
      noiseCount?: number;
    },
  ) => Promise<void>;
  failAnalyticsRun: (runId: unknown, error: unknown) => Promise<void>;
  /** Removes a run's topics + assignments — used to clean up a failed run's partial writes. */
  deleteRunResults: (runId: unknown) => Promise<void>;
  /** Retention: keep the most recent `keep` runs for the tenant, cascade-delete older ones. */
  pruneOldAnalyticsRuns: (tenantId: string | undefined, keep: number) => Promise<void>;
  getLatestAnalyticsRun: (filter: { tenantId?: string }) => Promise<IAnalyticsRun | null>;
  /**
   * Optional: fills in human-readable topic `label`s (anonymized keywords → LLM).
   * Absent or failing labeling degrades to keyword-only topics — never fails a run.
   */
  labelTopics?: (topics: ClusterResult['topics']) => Promise<ClusterResult['topics']>;
}

/** Lease must outlast a full pass (assemble + cluster + label + save); runs don't renew it. */
const DEFAULT_LEASE_MS = 30 * 60 * 1000;
/** Retention: how many recent runs to keep per tenant (only the latest is ever read). */
const DEFAULT_KEEP_RUNS = 10;

function logSummary(
  topics: Array<ClusterResult['topics'][number] & { label?: string }>,
  stats: ClusterResult['stats'],
): void {
  const preview = [...topics]
    .sort((a, b) => b.size - a.size)
    .slice(0, 10)
    .map((t) => `[${t.label || t.keywords.slice(0, 4).join('/') || t.topicKey}]×${t.size}`)
    .join(', ');
  logger.info(
    `[topics] clustered ${stats.conversations} conversations → ${stats.topics} topics ` +
      `(${stats.assigned} assigned, ${stats.noise} noise): ${preview}`,
  );
}

export function createTopicClusterer(deps: TopicClustererDeps) {
  /**
   * Runs one clustering pass over a window and persists the result: assemble
   * conversation texts → cluster (local topics service) → store topics +
   * assignments → mark the run done. On failure the run is marked failed (never
   * left dangling) and the error re-thrown to the caller. Topic LABELS are added
   * by a later step (anonymized text → LLM); this writes keyword-only topics.
   */
  async function runClustering(opts: {
    tenantId?: string;
    from?: Date;
    to?: Date;
    trigger?: AnalyticsRunTrigger;
    limit?: number;
    leaseMs?: number;
    keepRuns?: number;
  }): Promise<IAnalyticsRun> {
    // Dedup: never start a second pass for a tenant that already has one in flight
    // (overlapping scheduled + on-demand triggers, or a second replica). A run whose
    // lease has expired (crashed worker) is not "active" and does not block here.
    const active = await deps.getActiveAnalyticsRun(opts.tenantId);
    if (active) {
      logger.info(
        `[topics] an active run is already in progress (run ${String(active._id)}) — skipping`,
      );
      return active;
    }

    const keepRuns = opts.keepRuns ?? DEFAULT_KEEP_RUNS;
    const run = await deps.startAnalyticsRun({
      tenantId: opts.tenantId,
      windowStart: opts.from,
      windowEnd: opts.to,
      trigger: opts.trigger ?? 'scheduled',
      leaseMs: opts.leaseMs ?? DEFAULT_LEASE_MS,
    });
    // Retention runs only on success and must never fail the run itself.
    const pruneBestEffort = async () => {
      try {
        await deps.pruneOldAnalyticsRuns(opts.tenantId, keepRuns);
      } catch (pruneError) {
        logger.warn('[topics] run retention prune failed (non-fatal):', pruneError);
      }
    };

    try {
      const items = await deps.assembleConversationsForClustering(
        { tenantId: opts.tenantId, from: opts.from, to: opts.to },
        { limit: opts.limit },
      );
      if (!items.length) {
        await deps.completeAnalyticsRun(run._id, {
          conversationCount: 0,
          topicCount: 0,
          assignedCount: 0,
          noiseCount: 0,
        });
        logger.info(`[topics] run has no conversations in window — nothing to cluster`);
        await pruneBestEffort();
        return run;
      }

      const { topics, assignments, stats } = await deps.clusterConversations(
        items.map((it) => ({
          conversationId: it.conversationId,
          text: it.text,
          userId: it.userId,
          createdAt: it.createdAt ? new Date(it.createdAt).toISOString() : undefined,
        })),
      );

      // Best-effort labels (anonymized keywords → LLM). Never let labeling break the
      // run — fall back to keyword-only topics on any failure.
      let labeledTopics = topics;
      if (deps.labelTopics) {
        try {
          labeledTopics = await deps.labelTopics(topics);
        } catch (labelError) {
          logger.warn('[topics] labeling step failed; storing keyword-only topics:', labelError);
        }
      }

      await deps.saveRunResults(
        run._id,
        labeledTopics,
        assignments.map((a) => ({
          conversationId: a.conversationId,
          topicKey: a.topicKey,
          userId: a.userId,
          conversationCreatedAt: a.conversationCreatedAt
            ? new Date(a.conversationCreatedAt)
            : undefined,
          score: a.score,
        })),
      );
      await deps.completeAnalyticsRun(run._id, {
        conversationCount: stats.conversations,
        topicCount: stats.topics,
        assignedCount: stats.assigned,
        noiseCount: stats.noise,
      });
      logSummary(labeledTopics, stats);
      await pruneBestEffort();
      return run;
    } catch (error) {
      // Clean up any partially-written topics/assignments so a failed run never
      // leaves orphan rows behind the latest (done) run. Best-effort.
      try {
        await deps.deleteRunResults(run._id);
      } catch (cleanupError) {
        logger.warn('[topics] failed-run result cleanup failed (non-fatal):', cleanupError);
      }
      await deps.failAnalyticsRun(run._id, error);
      logger.error('[topics] clustering run failed:', error);
      throw error;
    }
  }

  /** Runs a pass only if the latest done run is older than `minIntervalMs` — so a
   * restart doesn't re-cluster, and the schedule stays at most one run per window. */
  async function runIfStale(opts: {
    tenantId?: string;
    from?: Date;
    to?: Date;
    limit?: number;
    leaseMs?: number;
    keepRuns?: number;
    minIntervalMs: number;
  }): Promise<IAnalyticsRun | null> {
    const latest = await deps.getLatestAnalyticsRun({ tenantId: opts.tenantId });
    if (
      latest?.createdAt &&
      Date.now() - new Date(latest.createdAt).getTime() < opts.minIntervalMs
    ) {
      return null;
    }
    return runClustering({ ...opts, trigger: 'scheduled' });
  }

  return { runClustering, runIfStale };
}

export type TopicClusterer = ReturnType<typeof createTopicClusterer>;
