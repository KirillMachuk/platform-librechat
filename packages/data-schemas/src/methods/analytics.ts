import { parseTextParts } from 'librechat-data-provider';
import { getTenantId } from '~/config/tenantContext';
import type { PipelineStage, FilterQuery, Model } from 'mongoose';
import type {
  IUser,
  IMessage,
  IConversation,
  AnalyticsConversation,
  AnalyticsInteraction,
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

/** Tenant-scoped `$lookup` sub-pipeline so joined conversations can never cross tenants. */
function convoLookupPipeline(tenantId?: string): PipelineStage.Lookup['$lookup']['pipeline'] {
  const conds: Array<{ $eq: [string, string] }> = [{ $eq: ['$conversationId', '$$cid'] }];
  if (tenantId) {
    conds.push({ $eq: ['$tenantId', tenantId] });
  }
  return [{ $match: { $expr: { $and: conds } } }, { $project: { _id: 0, title: 1, agent_id: 1 } }];
}

export function createAnalyticsMethods(mongoose: typeof import('mongoose')) {
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
      .select('conversationId')
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

  /**
   * Reads a page of employee↔AI request rows (newest first), joined to their
   * conversation (title/agent, tenant-scoped) and author (email/name). Heavy
   * filters are applied at the message level before the per-page join so cost
   * stays flat at scale. Over-fetches one row to report `hasMore` instead of an
   * exact total (which would force a full count scan on every page).
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
    const rows = await Message.aggregate<AnalyticsInteraction>([
      { $match: buildMatch(filter, conversationIds) },
      { $sort: { createdAt: -1 } },
      { $skip: options.offset },
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
          messageId: 1,
          conversationId: 1,
          userId: '$user',
          userEmail: '$usr.email',
          userName: '$usr.name',
          model: 1,
          endpoint: 1,
          agentId: '$convo.agent_id',
          conversationTitle: '$convo.title',
          preview: { $substrCP: [{ $ifNull: ['$text', ''] }, 0, PREVIEW_LEN] },
          tokenCount: 1,
          createdAt: 1,
        },
      },
    ]).option({ maxTimeMS: MAX_QUERY_MS });

    const hasMore = rows.length > options.limit;
    return { interactions: hasMore ? rows.slice(0, options.limit) : rows, hasMore };
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
      .select('conversationId title agent_id user')
      .maxTimeMS(MAX_QUERY_MS)
      .lean<Pick<IConversation, 'conversationId' | 'title' | 'agent_id' | 'user'> | null>();
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

    return {
      conversationId: convo.conversationId,
      title: convo.title,
      agentId: convo.agent_id,
      userId: convo.user,
      userEmail,
      userName,
      messages,
      truncated,
    };
  }

  return {
    listInteractions,
    countInteractions,
    getConversationDetail,
    resolveAgentConversationIds,
  };
}

export type AnalyticsMethods = ReturnType<typeof createAnalyticsMethods>;
