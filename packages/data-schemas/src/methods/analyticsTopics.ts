import type { FilterQuery, Model, Types } from 'mongoose';
import type {
  IMessage,
  IConversation,
  IAnalyticsRun,
  IAnalyticsTopic,
  ClusteringInput,
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

  /**
   * Starts a clustering run: creates it already `running` with a lease, so a
   * crashed worker's run becomes reclaimable once the lease expires. Pair with
   * `getActiveAnalyticsRun` to dedup (caller checks no active run exists first).
   * `leaseMs` MUST exceed the expected run time.
   */
  async function startAnalyticsRun(input: {
    tenantId?: string;
    trigger?: AnalyticsRunTrigger;
    windowStart?: Date;
    windowEnd?: Date;
    leaseMs: number;
  }): Promise<IAnalyticsRun> {
    const now = Date.now();
    return runModel().create({
      status: 'running',
      trigger: input.trigger ?? 'scheduled',
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      tenantId: input.tenantId,
      startedAt: new Date(now),
      leaseExpiresAt: new Date(now + input.leaseMs),
      attempts: 1,
    });
  }

  /**
   * The run currently holding the tenant's "slot": `pending`, or `running` with a
   * lease that has NOT expired. A running run whose lease expired (a crashed
   * worker) is NOT active and no longer blocks a fresh run. Used to dedup the
   * scheduled + on-demand (+ future multi-replica) triggers so only one clustering
   * pass runs at a time per tenant.
   */
  async function getActiveAnalyticsRun(tenantId?: string): Promise<IAnalyticsRun | null> {
    const match: FilterQuery<IAnalyticsRun> = {
      status: { $in: ['pending', 'running'] },
      $or: [{ leaseExpiresAt: null }, { leaseExpiresAt: { $gt: new Date() } }],
    };
    if (tenantId) {
      match.tenantId = tenantId;
    }
    return runModel()
      .findOne(match)
      .sort({ createdAt: -1 })
      .maxTimeMS(MAX_QUERY_MS)
      .lean<IAnalyticsRun | null>();
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

  /** Removes a run's topics + assignments (cleanup of a failed/partial run's writes). */
  async function deleteRunResults(runId: Types.ObjectId | string): Promise<void> {
    await topicModel().deleteMany({ runId });
    await assignmentModel().deleteMany({ runId });
  }

  /**
   * Retention: keeps the most recent `keep` runs for the tenant and deletes older
   * ones, cascading their topics + assignments — so the collections don't grow
   * unbounded (only the latest run is ever read). Call under the tenant's context.
   */
  async function pruneOldAnalyticsRuns(tenantId: string | undefined, keep: number): Promise<void> {
    const match: FilterQuery<IAnalyticsRun> = {};
    if (tenantId) {
      match.tenantId = tenantId;
    }
    const stale = await runModel()
      .find(match)
      .sort({ createdAt: -1 })
      .skip(Math.max(0, keep))
      .select('_id')
      .maxTimeMS(MAX_QUERY_MS)
      .lean<Array<{ _id: Types.ObjectId }>>();
    if (!stale.length) {
      return;
    }
    const ids = stale.map((r) => r._id);
    await topicModel().deleteMany({ runId: { $in: ids } });
    await assignmentModel().deleteMany({ runId: { $in: ids } });
    await runModel().deleteMany({ _id: { $in: ids } });
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

  /**
   * Conversation summaries (title + author + first request preview) for a set of
   * conversation ids, tenant-scoped, preserving the input order. Powers the
   * topic drill-in list. Reads are aggregate metadata + a short preview, not the
   * full transcript (that stays behind getConversationDetail / conversation.read).
   */
  async function getConversationSummaries(
    conversationIds: string[],
    tenantId?: string,
  ): Promise<
    Array<{
      conversationId: string;
      title?: string;
      userId?: string;
      userEmail?: string;
      userName?: string;
      createdAt?: Date;
      preview: string;
    }>
  > {
    if (!conversationIds.length) {
      return [];
    }
    const Conversation = mongoose.models.Conversation as Model<IConversation>;
    const convoMatch: FilterQuery<IConversation> = { conversationId: { $in: conversationIds } };
    if (tenantId) {
      convoMatch.tenantId = tenantId;
    }
    const firstUserMessageConds: Array<Record<string, unknown>> = [
      { $eq: ['$conversationId', '$$cid'] },
      { $eq: ['$isCreatedByUser', true] },
    ];
    if (tenantId) {
      firstUserMessageConds.push({ $eq: ['$tenantId', tenantId] });
    }
    const rows = await Conversation.aggregate<{
      conversationId: string;
      title?: string;
      userId?: string;
      userEmail?: string;
      userName?: string;
      createdAt?: Date;
      preview: string;
    }>([
      { $match: convoMatch },
      {
        $addFields: {
          _userOid: { $convert: { input: '$user', to: 'objectId', onError: null, onNull: null } },
        },
      },
      { $lookup: { from: 'users', localField: '_userOid', foreignField: '_id', as: 'usr' } },
      { $unwind: { path: '$usr', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'messages',
          let: { cid: '$conversationId' },
          pipeline: [
            { $match: { $expr: { $and: firstUserMessageConds } } },
            { $sort: { createdAt: 1 } },
            { $limit: 1 },
            { $project: { _id: 0, text: 1 } },
          ],
          as: 'firstMsg',
        },
      },
      { $unwind: { path: '$firstMsg', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          conversationId: 1,
          title: 1,
          userId: '$user',
          userEmail: '$usr.email',
          userName: '$usr.name',
          createdAt: 1,
          preview: { $substrCP: [{ $ifNull: ['$firstMsg.text', ''] }, 0, 200] },
        },
      },
    ]).option({ maxTimeMS: MAX_QUERY_MS });

    const order = new Map(conversationIds.map((id, i) => [id, i]));
    rows.sort((a, b) => (order.get(a.conversationId) ?? 0) - (order.get(b.conversationId) ?? 0));
    return rows;
  }

  /**
   * Distinct tenant ids that have conversations — the set the scheduler iterates,
   * running one clustering pass per tenant. Returns `[undefined]` for a
   * single-tenant deployment (no tenantId), so the caller runs one unscoped pass.
   * Call under `runAsSystem` to enumerate across tenants.
   */
  async function getClusteringTenantIds(): Promise<(string | undefined)[]> {
    const Conversation = mongoose.models.Conversation as Model<IConversation>;
    const ids = (await Conversation.distinct('tenantId').maxTimeMS(MAX_QUERY_MS)) as Array<
      string | null | undefined
    >;
    const tenants = ids.filter((t): t is string => Boolean(t));
    return tenants.length ? tenants : [undefined];
  }

  return {
    assembleConversationsForClustering,
    startAnalyticsRun,
    getActiveAnalyticsRun,
    completeAnalyticsRun,
    failAnalyticsRun,
    getLatestAnalyticsRun,
    saveRunResults,
    deleteRunResults,
    pruneOldAnalyticsRuns,
    getRunTopics,
    getTopicAssignments,
    getConversationSummaries,
    getClusteringTenantIds,
  };
}

export type AnalyticsTopicsMethods = ReturnType<typeof createAnalyticsTopicsMethods>;
