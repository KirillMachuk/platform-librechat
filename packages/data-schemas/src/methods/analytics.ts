import type { FilterQuery, Model } from 'mongoose';
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
const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

function escapeRegex(value: string): string {
  return value.replace(REGEX_SPECIALS, '\\$&');
}

/** Resolves display text: prefers `text`, else concatenates text parts of `content`. */
function resolveText(text?: string, content?: unknown[]): string {
  if (text && text.trim()) {
    return text;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  const parts: string[] = [];
  for (const part of content) {
    if (part && typeof part === 'object' && 'text' in part) {
      const value = (part as { text?: unknown }).text;
      if (typeof value === 'string' && value) {
        parts.push(value);
      }
    }
  }
  return parts.join('\n');
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
   * Reads a page of employee↔AI request rows (newest first): user messages joined
   * to their conversation (title/agent) and author (email/name). Heavy filters are
   * applied at the message level before the per-page join to keep cost flat at scale.
   */
  async function listInteractions(
    filter: AnalyticsInteractionFilter,
    options: { limit: number; offset: number },
  ): Promise<AnalyticsInteraction[]> {
    const Message = mongoose.models.Message as Model<IMessage>;
    let conversationIds: string[] | undefined;
    if (filter.agentId) {
      conversationIds = await resolveAgentConversationIds(filter.agentId, filter.tenantId);
      if (!conversationIds.length) {
        return [];
      }
    }
    return Message.aggregate<AnalyticsInteraction>([
      { $match: buildMatch(filter, conversationIds) },
      { $sort: { createdAt: -1 } },
      { $skip: options.offset },
      { $limit: options.limit },
      {
        $lookup: {
          from: 'conversations',
          localField: 'conversationId',
          foreignField: 'conversationId',
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
    ]);
  }

  async function countInteractions(filter: AnalyticsInteractionFilter): Promise<number> {
    const Message = mongoose.models.Message as Model<IMessage>;
    let conversationIds: string[] | undefined;
    if (filter.agentId) {
      conversationIds = await resolveAgentConversationIds(filter.agentId, filter.tenantId);
      if (!conversationIds.length) {
        return 0;
      }
    }
    return Message.countDocuments(buildMatch(filter, conversationIds));
  }

  /** Loads a full conversation (all turns, oldest first) for read-only admin review. */
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
      .lean<ConversationMessageRow[]>();

    const messages: AnalyticsConversationMessage[] = docs.map((m) => ({
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
    };
  }

  return { listInteractions, countInteractions, getConversationDetail };
}

export type AnalyticsMethods = ReturnType<typeof createAnalyticsMethods>;
