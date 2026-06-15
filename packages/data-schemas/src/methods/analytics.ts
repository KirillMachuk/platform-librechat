import { parseTextParts, parseEphemeralAgentId } from 'librechat-data-provider';
import { getTenantId } from '~/config/tenantContext';
import type { PipelineStage, FilterQuery, Model } from 'mongoose';
import type {
  IUser,
  IMessage,
  IConversation,
  AnalyticsConversation,
  AnalyticsInteraction,
  AnalyticsExportRow,
  AnalyticsConversationMessage,
  AnalyticsInteractionFilter,
} from '~/types';

/** Max characters of request text returned in the feed preview. */
const PREVIEW_LEN = 280;
/** Safety cap on turns returned for a single conversation detail view. */
const MAX_CONVERSATION_MESSAGES = 2000;
/** Hard server-side time budget for analytics queries (ms). */
const MAX_QUERY_MS = 15000;
const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

function escapeRegex(value: string): string {
  return value.replace(REGEX_SPECIALS, '\\$&');
}

/** Quotes a value for a MeiliSearch filter expression, escaping `"` and `\`. */
function meiliQuote(value: string): string {
  return `"${value.replace(/["\\]/g, '\\$&')}"`;
}

/**
 * Resolves a message's display text. Prefers the top-level `text` column; for
 * agent/assistant turns (where `text` is empty and the answer lives in
 * `content` as `{ value }` / `think` parts) it falls back to the canonical
 * `parseTextParts` flattener so the viewer matches what the chat UI renders.
 */
function resolveText(text?: string, content?: unknown[]): string {
  if (text && text.trim()) {
    return text;
  }
  if (Array.isArray(content) && content.length) {
    return parseTextParts(content as Parameters<typeof parseTextParts>[0]);
  }
  return '';
}

/**
 * Resolves a human-readable model + (real) agent name from raw join fields.
 * The default 1ma chat wraps a model in an *ephemeral* agent whose id encodes
 * `endpoint__model___sender` — that is a model, not a real agent, so we surface
 * the model and no agent name. Only genuinely named agents get an agent name.
 */
function resolveModelAgent(
  agentId: string | undefined,
  messageModel: string | undefined,
  convoModel: string | undefined,
  agentNames: Map<string, string>,
): { model?: string; agentName?: string } {
  if (!agentId) {
    return { model: messageModel ?? convoModel };
  }
  const ephemeral = parseEphemeralAgentId(agentId);
  if (ephemeral) {
    return { model: messageModel ?? ephemeral.model ?? convoModel };
  }
  return { model: messageModel ?? convoModel, agentName: agentNames.get(agentId) ?? agentId };
}

type ConversationMessageRow = Pick<
  IMessage,
  | 'messageId'
  | 'parentMessageId'
  | 'isCreatedByUser'
  | 'sender'
  | 'text'
  | 'content'
  | 'model'
  | 'endpoint'
  | 'createdAt'
>;

/** Raw projection of the interactions aggregation, before model/agent resolution. */
type RawInteractionRow = {
  messageId: string;
  conversationId: string;
  userId: string;
  userEmail?: string;
  userName?: string;
  model?: string;
  endpoint?: string;
  agentId?: string;
  convoModel?: string;
  conversationTitle?: string;
  preview: string;
  createdAt: Date;
};

/** Raw projection of the export aggregation (full request text, before resolution). */
type RawExportRow = {
  userId: string;
  userEmail?: string;
  userName?: string;
  model?: string;
  agentId?: string;
  convoModel?: string;
  text: string;
  createdAt: Date;
};

/** Tenant-scoped `$lookup` sub-pipeline so joined conversations can never cross tenants. */
function convoLookupPipeline(tenantId?: string): PipelineStage.Lookup['$lookup']['pipeline'] {
  const conds: Array<{ $eq: [string, string] }> = [{ $eq: ['$conversationId', '$$cid'] }];
  if (tenantId) {
    conds.push({ $eq: ['$tenantId', tenantId] });
  }
  return [
    { $match: { $expr: { $and: conds } } },
    { $project: { _id: 0, title: 1, agent_id: 1, model: 1 } },
  ];
}

/**
 * Joins matched message rows to their conversation (tenant-scoped) and author,
 * then projects the `RawInteractionRow` shape. Shared by the Mongo feed and the
 * Meili-ranked hydration so both produce identical rows. `tenantId` (from the
 * request's ALS context) scopes the conversation join — never cross-tenant.
 */
function interactionEnrichmentStages(tenantId?: string): PipelineStage[] {
  return [
    {
      $lookup: {
        from: 'conversations',
        let: { cid: '$conversationId' },
        pipeline: convoLookupPipeline(tenantId),
        as: 'convo',
      },
    },
    { $unwind: { path: '$convo', preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        _userOid: { $convert: { input: '$user', to: 'objectId', onError: null, onNull: null } },
      },
    },
    { $lookup: { from: 'users', localField: '_userOid', foreignField: '_id', as: 'usr' } },
    { $unwind: { path: '$usr', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        messageId: 1,
        conversationId: 1,
        userId: '$user',
        userEmail: '$usr.email',
        userName: '$usr.name',
        model: 1,
        endpoint: 1,
        agentId: '$convo.agent_id',
        convoModel: '$convo.model',
        conversationTitle: '$convo.title',
        preview: { $substrCP: [{ $ifNull: ['$text', ''] }, 0, PREVIEW_LEN] },
        createdAt: 1,
      },
    },
  ];
}

export function createAnalyticsMethods(mongoose: typeof import('mongoose')) {
  /** Batch-resolves real (named) agent ids to display names. Ephemeral ids are skipped by the caller. */
  async function fetchAgentNames(agentIds: string[]): Promise<Map<string, string>> {
    if (!agentIds.length) {
      return new Map();
    }
    const Agent = mongoose.models.Agent as Model<{ id: string; name?: string }>;
    const agents = await Agent.find({ id: { $in: agentIds } })
      .select('id name -_id')
      .maxTimeMS(MAX_QUERY_MS)
      .lean<{ id: string; name?: string }[]>();
    return new Map(agents.filter((a) => a.name).map((a) => [a.id, a.name as string]));
  }

  /** Conversation ids belonging to a given agent (scoped to tenant when provided). */
  async function resolveAgentConversationIds(
    agentId: string,
    tenantId?: string,
  ): Promise<string[]> {
    const Conversation = mongoose.models.Conversation as Model<IConversation>;
    const filter: FilterQuery<IConversation> = { agent_id: agentId };
    if (tenantId) {
      filter.tenantId = tenantId;
    }
    const convos = await Conversation.find(filter)
      .select('conversationId -_id')
      .maxTimeMS(MAX_QUERY_MS)
      .lean<{ conversationId: string }[]>();
    return convos.map((c) => c.conversationId).filter(Boolean);
  }

  function buildMatch(
    filter: AnalyticsInteractionFilter,
    conversationIds?: string[],
  ): FilterQuery<IMessage> {
    const match: FilterQuery<IMessage> = { isCreatedByUser: true };
    if (filter.tenantId) {
      match.tenantId = filter.tenantId;
    }
    if (filter.userId) {
      match.user = filter.userId;
    }
    if (filter.model) {
      match.model = filter.model;
    }
    if (filter.endpoint) {
      match.endpoint = filter.endpoint;
    }
    if (conversationIds) {
      match.conversationId = { $in: conversationIds };
    }
    if (filter.search) {
      match.text = { $regex: escapeRegex(filter.search), $options: 'i' };
    }
    if (filter.from || filter.to) {
      const createdAt: { $gte?: Date; $lt?: Date } = {};
      if (filter.from) {
        createdAt.$gte = filter.from;
      }
      if (filter.to) {
        createdAt.$lt = filter.to;
      }
      match.createdAt = createdAt;
    }
    return match;
  }

  /** Resolves agent display names and maps raw projected rows to the feed DTO. */
  async function mapRawToInteractions(rows: RawInteractionRow[]): Promise<AnalyticsInteraction[]> {
    const realAgentIds = [
      ...new Set(
        rows
          .map((r) => r.agentId)
          .filter((id): id is string => Boolean(id) && !parseEphemeralAgentId(id as string)),
      ),
    ];
    const agentNames = await fetchAgentNames(realAgentIds);

    return rows.map((r) => {
      const { model, agentName } = resolveModelAgent(r.agentId, r.model, r.convoModel, agentNames);
      return {
        messageId: r.messageId,
        conversationId: r.conversationId,
        userId: r.userId,
        userEmail: r.userEmail,
        userName: r.userName,
        model,
        endpoint: r.endpoint,
        agentName,
        conversationTitle: r.conversationTitle,
        preview: r.preview,
        createdAt: r.createdAt,
      };
    });
  }

  /**
   * Reads a page of employee↔AI request rows (newest first), joined to their
   * conversation (title/agent/model, tenant-scoped) and author (email/name).
   * Heavy filters are applied at the message level before the per-page join so
   * cost stays flat at scale. Over-fetches one row to report `hasMore` instead
   * of an exact total (which would force a full count scan on every page).
   */
  async function listInteractions(
    filter: AnalyticsInteractionFilter,
    options: { limit: number; offset: number },
  ): Promise<{ interactions: AnalyticsInteraction[]; hasMore: boolean }> {
    const Message = mongoose.models.Message as Model<IMessage>;
    let conversationIds = filter.conversationIds;
    if (!conversationIds && filter.agentId) {
      conversationIds = await resolveAgentConversationIds(filter.agentId, filter.tenantId);
      if (!conversationIds.length) {
        return { interactions: [], hasMore: false };
      }
    }
    const tenantId = getTenantId();
    const raw = await Message.aggregate<RawInteractionRow>([
      { $match: buildMatch(filter, conversationIds) },
      { $sort: { createdAt: -1 } },
      { $skip: options.offset },
      { $limit: options.limit + 1 },
      ...interactionEnrichmentStages(tenantId),
    ]).option({ maxTimeMS: MAX_QUERY_MS });

    const hasMore = raw.length > options.limit;
    const page = hasMore ? raw.slice(0, options.limit) : raw;
    const interactions = await mapRawToInteractions(page);

    return { interactions, hasMore };
  }

  /**
   * Hydrates a list of messageIds (already ranked by the search backend) into the
   * feed DTO, preserving the input order. Used by the MeiliSearch search path:
   * Meili ranks + paginates, then this fills in the conversation/author joins.
   * Re-applies the tenant + employee filters as defense in depth so a stray id
   * can never surface another tenant's content.
   */
  async function listInteractionsByIds(
    messageIds: string[],
    filter: AnalyticsInteractionFilter,
  ): Promise<AnalyticsInteraction[]> {
    if (!messageIds.length) {
      return [];
    }
    const Message = mongoose.models.Message as Model<IMessage>;
    const tenantId = getTenantId();
    const match: FilterQuery<IMessage> = {
      messageId: { $in: messageIds },
      isCreatedByUser: true,
    };
    if (filter.tenantId) {
      match.tenantId = filter.tenantId;
    }
    const raw = await Message.aggregate<RawInteractionRow>([
      { $match: match },
      ...interactionEnrichmentStages(tenantId),
    ]).option({ maxTimeMS: MAX_QUERY_MS });

    const interactions = await mapRawToInteractions(raw);
    // Preserve the search backend's ranking — Mongo `$in` does not order by it.
    const rank = new Map(messageIds.map((id, i) => [id, i]));
    interactions.sort((a, b) => (rank.get(a.messageId) ?? 0) - (rank.get(b.messageId) ?? 0));
    return interactions;
  }

  /**
   * Resolves a ranked, typo-tolerant page of messageIds for a text query via
   * MeiliSearch (the `messages` index the chat search already maintains). The
   * query is the message text; structured constraints (tenant, employee flag,
   * period, optional employee) are pushed down as Meili filters so the scan is
   * index-served, not a Mongo collection scan.
   *
   * Returns `null` only when the Meili plugin is not registered, so the caller
   * can fall back to the Mongo `$regex` path.
   *
   * TENANT ISOLATION (mirrors the Mongo `buildMatch`): the `tenantId` filter is
   * applied when, and only when, the request carries one. Meili bypasses the
   * Mongoose tenant middleware, so a cross-user search MUST self-impose the
   * filter — which it does whenever `filter.tenantId` is set (multi-tenant).
   * When it is absent (single-tenant container-per-client — the standard
   * deployment) there is exactly one tenant in the database, so searching
   * without a tenant clause is correct, not a leak. Requiring `tenantId` here
   * would make the feature silently dead in single-tenant deployments while
   * giving no more isolation than the already-shipped Mongo path.
   */
  async function searchInteractionIds(
    filter: AnalyticsInteractionFilter,
    options: { limit: number; offset: number },
  ): Promise<{ ids: string[]; hasMore: boolean } | null> {
    const Message = mongoose.models.Message as Model<IMessage> & {
      meiliSearch?: (
        q: string,
        params: Record<string, unknown>,
        populate?: boolean,
      ) => Promise<{ hits?: Array<Record<string, unknown>> }>;
    };
    if (typeof Message.meiliSearch !== 'function') {
      return null;
    }
    const clauses: string[] = ['isCreatedByUser = true'];
    if (filter.tenantId) {
      clauses.push(`tenantId = ${meiliQuote(filter.tenantId)}`);
    }
    if (filter.userId) {
      clauses.push(`user = ${meiliQuote(filter.userId)}`);
    }
    if (filter.from) {
      clauses.push(`createdAtTs >= ${new Date(filter.from).getTime()}`);
    }
    if (filter.to) {
      clauses.push(`createdAtTs < ${new Date(filter.to).getTime()}`);
    }

    const response = await Message.meiliSearch(
      filter.search ?? '',
      {
        filter: clauses.join(' AND '),
        // Newest-first, matching the feed — relevance alone would bury recent
        // matches under older "more relevant" ones (admins expect recency).
        sort: ['createdAtTs:desc'],
        limit: options.limit + 1,
        offset: options.offset,
        attributesToRetrieve: ['messageId'],
      },
      false,
    );

    const ids = (response.hits ?? [])
      .map((h) => h.messageId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    const hasMore = ids.length > options.limit;
    return { ids: hasMore ? ids.slice(0, options.limit) : ids, hasMore };
  }

  /**
   * Reads matching request rows for CSV export — same filter as the feed, but
   * returns the FULL request text (not the truncated preview), newest first,
   * capped by `options.limit`. Resolves model/agent and author like the feed.
   */
  async function exportInteractions(
    filter: AnalyticsInteractionFilter,
    options: { limit: number },
  ): Promise<{ rows: AnalyticsExportRow[]; truncated: boolean }> {
    const Message = mongoose.models.Message as Model<IMessage>;
    let conversationIds = filter.conversationIds;
    if (!conversationIds && filter.agentId) {
      conversationIds = await resolveAgentConversationIds(filter.agentId, filter.tenantId);
      if (!conversationIds.length) {
        return { rows: [], truncated: false };
      }
    }
    const tenantId = getTenantId();
    // Over-fetch one row past the cap so we can flag a truncated export (mirrors
    // getConversationDetail) instead of silently dropping the oldest requests.
    const raw = await Message.aggregate<RawExportRow>([
      { $match: buildMatch(filter, conversationIds) },
      { $sort: { createdAt: -1 } },
      { $limit: options.limit + 1 },
      {
        $lookup: {
          from: 'conversations',
          let: { cid: '$conversationId' },
          pipeline: convoLookupPipeline(tenantId),
          as: 'convo',
        },
      },
      { $unwind: { path: '$convo', preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          _userOid: { $convert: { input: '$user', to: 'objectId', onError: null, onNull: null } },
        },
      },
      { $lookup: { from: 'users', localField: '_userOid', foreignField: '_id', as: 'usr' } },
      { $unwind: { path: '$usr', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          userId: '$user',
          userEmail: '$usr.email',
          userName: '$usr.name',
          model: 1,
          agentId: '$convo.agent_id',
          convoModel: '$convo.model',
          text: { $ifNull: ['$text', ''] },
          createdAt: 1,
        },
      },
    ]).option({ maxTimeMS: MAX_QUERY_MS });

    const truncated = raw.length > options.limit;
    const page = truncated ? raw.slice(0, options.limit) : raw;

    const realAgentIds = [
      ...new Set(
        page
          .map((r) => r.agentId)
          .filter((id): id is string => Boolean(id) && !parseEphemeralAgentId(id as string)),
      ),
    ];
    const agentNames = await fetchAgentNames(realAgentIds);

    const rows = page.map((r) => {
      const { model, agentName } = resolveModelAgent(r.agentId, r.model, r.convoModel, agentNames);
      return {
        createdAt: r.createdAt,
        userId: r.userId,
        userEmail: r.userEmail,
        userName: r.userName,
        model,
        agentName,
        text: r.text,
      };
    });
    return { rows, truncated };
  }

  /** Exact match count for a filter. Not used by the paged feed (which uses
   * `hasMore`); kept for aggregate/dashboard callers that need a real total. */
  async function countInteractions(filter: AnalyticsInteractionFilter): Promise<number> {
    const Message = mongoose.models.Message as Model<IMessage>;
    let conversationIds = filter.conversationIds;
    if (!conversationIds && filter.agentId) {
      conversationIds = await resolveAgentConversationIds(filter.agentId, filter.tenantId);
      if (!conversationIds.length) {
        return 0;
      }
    }
    return Message.countDocuments(buildMatch(filter, conversationIds)).maxTimeMS(MAX_QUERY_MS);
  }

  /** Loads a conversation (oldest first, capped) for read-only admin review. */
  async function getConversationDetail(
    conversationId: string,
    tenantId?: string,
  ): Promise<AnalyticsConversation | null> {
    const Conversation = mongoose.models.Conversation as Model<IConversation>;
    const Message = mongoose.models.Message as Model<IMessage>;
    const User = mongoose.models.User as Model<IUser>;

    const convoFilter: FilterQuery<IConversation> = { conversationId };
    if (tenantId) {
      convoFilter.tenantId = tenantId;
    }
    const convo = await Conversation.findOne(convoFilter)
      .select('conversationId title agent_id model user')
      .maxTimeMS(MAX_QUERY_MS)
      .lean<Pick<
        IConversation,
        'conversationId' | 'title' | 'agent_id' | 'model' | 'user'
      > | null>();
    if (!convo) {
      return null;
    }

    const msgFilter: FilterQuery<IMessage> = { conversationId };
    if (tenantId) {
      msgFilter.tenantId = tenantId;
    }
    const docs = await Message.find(msgFilter)
      .sort({ createdAt: 1 })
      .select(
        'messageId parentMessageId isCreatedByUser sender text content model endpoint createdAt',
      )
      .limit(MAX_CONVERSATION_MESSAGES + 1)
      .maxTimeMS(MAX_QUERY_MS)
      .lean<ConversationMessageRow[]>();

    const truncated = docs.length > MAX_CONVERSATION_MESSAGES;
    const turns = truncated ? docs.slice(0, MAX_CONVERSATION_MESSAGES) : docs;

    const messages: AnalyticsConversationMessage[] = turns.map((m) => ({
      messageId: m.messageId,
      parentMessageId: m.parentMessageId ?? null,
      isCreatedByUser: Boolean(m.isCreatedByUser),
      sender: m.sender,
      text: resolveText(m.text, m.content),
      model: m.model ?? undefined,
      endpoint: m.endpoint,
      createdAt: m.createdAt,
    }));

    let userEmail: string | undefined;
    let userName: string | undefined;
    if (convo.user) {
      const user = await User.findById(convo.user)
        .select('email name')
        .maxTimeMS(MAX_QUERY_MS)
        .lean<Pick<IUser, 'email' | 'name'> | null>();
      userEmail = user?.email;
      userName = user?.name;
    }

    const agentNames =
      convo.agent_id && !parseEphemeralAgentId(convo.agent_id)
        ? await fetchAgentNames([convo.agent_id])
        : new Map<string, string>();
    const { model, agentName } = resolveModelAgent(
      convo.agent_id,
      undefined,
      convo.model,
      agentNames,
    );

    return {
      conversationId: convo.conversationId,
      title: convo.title,
      model,
      agentName,
      userId: convo.user,
      userEmail,
      userName,
      messages,
      truncated,
    };
  }

  return {
    listInteractions,
    listInteractionsByIds,
    searchInteractionIds,
    exportInteractions,
    countInteractions,
    getConversationDetail,
    resolveAgentConversationIds,
  };
}

export type AnalyticsMethods = ReturnType<typeof createAnalyticsMethods>;
