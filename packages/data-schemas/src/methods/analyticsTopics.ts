import type { FilterQuery, Model, Types } from 'mongoose';
import type {
  IMessage,
  IConversation,
  IAnalyticsRun,
  IAnalyticsTopic,
  ClusteringInput,
  AnalyticsRunStatus,
  IAnalyticsAssignment,
  AnalyticsRunTrigger,
} from '~/types';

/** Clustering reads sweep a window of history, so allow a larger budget than the live feed. */
const MAX_QUERY_MS = 30000;
/** Default ceiling on conversations pulled into one run (sliding window keeps this bounded). */
const DEFAULT_RUN_LIMIT = 5000;
/** How many of a conversation's first employee turns represent it for clustering. */
const DEFAULT_MAX_USER_TURNS = 3;

/** Subset of a run's terminal stats, written on completion. */
interface AnalyticsRunStats {
  conversationCount?: number;
  topicCount?: number;
  assignedCount?: number;
  noiseCount?: number;
}

/** A discovered topic as produced by the clusterer (before persistence adds run/tenant). */
type TopicResultInput = Pick<
  IAnalyticsTopic,
  | 'topicKey'
  | 'label'
  | 'keywords'
  | 'size'
  | 'share'
  | 'representativeConversationIds'
  | 'centroid'
>;

/** A conversation→topic placement as produced by the clusterer. */
type AssignmentResultInput = Pick<
  IAnalyticsAssignment,
  'conversationId' | 'topicKey' | 'userId' | 'conversationCreatedAt' | 'score'
>;

export function createAnalyticsTopicsMethods(mongoose: typeof import('mongoose')) {
  const runModel = () => mongoose.models.AnalyticsRun as Model<IAnalyticsRun>;
  const topicModel = () => mongoose.models.AnalyticsTopic as Model<IAnalyticsTopic>;
  const assignmentModel = () => mongoose.models.AnalyticsAssignment as Model<IAnalyticsAssignment>;

  /**
   * Builds the clustering input for a tenant + window: each conversation reduced to
   * its title plus its first few employee turns. Raw text is returned on purpose —
   * embedding happens LOCALLY (in-country), so it sees real text; only the later
   * label step (external LLM) goes through the anonymizer.
   */
  async function assembleConversationsForClustering(
    filter: { tenantId?: string; from?: Date; to?: Date },
    options: { limit?: number; maxUserTurns?: number } = {},
  ): Promise<ClusteringInput[]> {
    const limit = options.limit ?? DEFAULT_RUN_LIMIT;
    const maxUserTurns = options.maxUserTurns ?? DEFAULT_MAX_USER_TURNS;
    const Conversation = mongoose.models.Conversation as Model<IConversation>;
    const Message = mongoose.models.Message as Model<IMessage>;

    const convoMatch: FilterQuery<IConversation> = {};
    if (filter.tenantId) {
      convoMatch.tenantId = filter.tenantId;
    }
    if (filter.from || filter.to) {
      const createdAt: { $gte?: Date; $lt?: Date } = {};
      if (filter.from) {
        createdAt.$gte = filter.from;
      }
      if (filter.to) {
        createdAt.$lt = filter.to;
      }
      convoMatch.createdAt = createdAt;
    }

    const convos = await Conversation.find(convoMatch)
      .select('conversationId title user createdAt')
      .sort({ createdAt: -1 })
      .limit(limit)
      .maxTimeMS(MAX_QUERY_MS)
      .lean<Array<{ conversationId: string; title?: string; user?: string; createdAt?: Date }>>();
    if (!convos.length) {
      return [];
    }

    const ids = convos.map((c) => c.conversationId);
    const msgMatch: FilterQuery<IMessage> = { conversationId: { $in: ids }, isCreatedByUser: true };
    if (filter.tenantId) {
      msgMatch.tenantId = filter.tenantId;
    }
    const grouped = await Message.aggregate<{ _id: string; texts: string[] }>([
      { $match: msgMatch },
      { $sort: { createdAt: 1 } },
      { $group: { _id: '$conversationId', texts: { $push: { $ifNull: ['$text', ''] } } } },
      { $project: { texts: { $slice: ['$texts', maxUserTurns] } } },
    ]).option({ maxTimeMS: MAX_QUERY_MS });

    const turnsByConvo = new Map(
      grouped.map((g) => [g._id, (g.texts ?? []).map((t) => (t ?? '').trim()).filter(Boolean)]),
    );

    return convos
      .map((c) => {
        const turns = turnsByConvo.get(c.conversationId) ?? [];
        const text = [(c.title ?? '').trim(), ...turns].filter(Boolean).join('\n');
        return {
          conversationId: c.conversationId,
          userId: c.user,
          title: c.title,
          text,
          createdAt: c.createdAt,
        };
      })
      .filter((c) => c.text.length > 0);
  }

  /** Creates a pending run (the schedule enqueues runs; a leased worker executes them). */
  async function createAnalyticsRun(input: {
    tenantId?: string;
    trigger?: AnalyticsRunTrigger;
    windowStart?: Date;
    windowEnd?: Date;
  }): Promise<IAnalyticsRun> {
    return runModel().create({
      status: 'pending',
      trigger: input.trigger ?? 'scheduled',
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      tenantId: input.tenantId,
    });
  }

  /**
   * Atomically claims the next runnable run (pending, or running with an expired
   * lease — a crashed worker) and marks it running with a fresh lease, so concurrent
   * workers/replicas can never double-run. Call under `runAsSystem` to claim across
   * tenants. `leaseMs` MUST exceed the work timeout or another worker could re-claim
   * mid-flight.
   */
  async function claimNextAnalyticsRun(leaseMs: number): Promise<IAnalyticsRun | null> {
    const now = Date.now();
    return runModel().findOneAndUpdate(
      {
        status: { $in: ['pending', 'running'] },
        $or: [{ leaseExpiresAt: null }, { leaseExpiresAt: { $lte: new Date(now) } }],
      },
      {
        $set: {
          status: 'running' as AnalyticsRunStatus,
          leaseExpiresAt: new Date(now + leaseMs),
          startedAt: new Date(now),
        },
        $inc: { attempts: 1 },
      },
      { sort: { createdAt: 1 }, new: true },
    );
  }

  /** Extends the lease of an in-flight run (call periodically for long runs). */
  async function renewAnalyticsRunLease(
    runId: Types.ObjectId | string,
    leaseMs: number,
  ): Promise<void> {
    await runModel().updateOne(
      { _id: runId },
      { $set: { leaseExpiresAt: new Date(Date.now() + leaseMs) } },
    );
  }

  /** Marks a run done and records its summary stats; clears the lease. */
  async function completeAnalyticsRun(
    runId: Types.ObjectId | string,
    stats: AnalyticsRunStats = {},
  ): Promise<void> {
    await runModel().updateOne(
      { _id: runId },
      { $set: { status: 'done', finishedAt: new Date(), leaseExpiresAt: null, ...stats } },
    );
  }

  /** Marks a run failed with a (truncated) error; clears the lease so retry logic can re-pick. */
  async function failAnalyticsRun(runId: Types.ObjectId | string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    await runModel().updateOne(
      { _id: runId },
      {
        $set: {
          status: 'failed',
          finishedAt: new Date(),
          leaseExpiresAt: null,
          error: message.slice(0, 2000),
        },
      },
    );
  }

  /** Newest completed run (the read path for the topics screen). */
  async function getLatestAnalyticsRun(
    filter: { tenantId?: string } = {},
  ): Promise<IAnalyticsRun | null> {
    const match: FilterQuery<IAnalyticsRun> = { status: 'done' };
    if (filter.tenantId) {
      match.tenantId = filter.tenantId;
    }
    return runModel()
      .findOne(match)
      .sort({ createdAt: -1 })
      .maxTimeMS(MAX_QUERY_MS)
      .lean<IAnalyticsRun | null>();
  }

  /**
   * Idempotently persists a run's results: replaces any prior topics/assignments for
   * the run, then inserts the new ones. Tenant id is stamped by the tenantIsolation
   * hooks from the active context (the worker runs each tenant under its own context).
   */
  async function saveRunResults(
    runId: Types.ObjectId | string,
    topics: TopicResultInput[],
    assignments: AssignmentResultInput[],
  ): Promise<void> {
    await topicModel().deleteMany({ runId });
    await assignmentModel().deleteMany({ runId });
    if (topics.length) {
      await topicModel().insertMany(
        topics.map((t) => ({ ...t, runId })),
        { ordered: false },
      );
    }
    if (assignments.length) {
      await assignmentModel().insertMany(
        assignments.map((a) => ({ ...a, runId })),
        { ordered: false },
      );
    }
  }

  /** Topics of a run, largest theme first (the distribution view). */
  async function getRunTopics(runId: Types.ObjectId | string): Promise<IAnalyticsTopic[]> {
    return topicModel()
      .find({ runId })
      .sort({ size: -1 })
      .maxTimeMS(MAX_QUERY_MS)
      .lean<IAnalyticsTopic[]>();
  }

  /** A page of a topic's conversation assignments, newest conversation first (drill-in). */
  async function getTopicAssignments(
    runId: Types.ObjectId | string,
    topicKey: number,
    options: { limit: number; offset: number },
  ): Promise<IAnalyticsAssignment[]> {
    return assignmentModel()
      .find({ runId, topicKey })
      .sort({ conversationCreatedAt: -1 })
      .skip(options.offset)
      .limit(options.limit)
      .maxTimeMS(MAX_QUERY_MS)
      .lean<IAnalyticsAssignment[]>();
  }

  return {
    assembleConversationsForClustering,
    createAnalyticsRun,
    claimNextAnalyticsRun,
    renewAnalyticsRunLease,
    completeAnalyticsRun,
    failAnalyticsRun,
    getLatestAnalyticsRun,
    saveRunResults,
    getRunTopics,
    getTopicAssignments,
  };
}

export type AnalyticsTopicsMethods = ReturnType<typeof createAnalyticsTopicsMethods>;
