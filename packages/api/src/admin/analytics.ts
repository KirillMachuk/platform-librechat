import { logger, isValidObjectIdString } from '@librechat/data-schemas';
import type {
  AuditLogInput,
  AdminInteraction,
  AnalyticsConversation,
  AnalyticsInteraction,
  AdminConversationDetail,
  AnalyticsInteractionFilter,
} from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import { auditRequestContext } from '~/audit/service';
import { parsePagination } from './pagination';

export interface AdminAnalyticsDeps {
  listInteractions: (
    filter: AnalyticsInteractionFilter,
    options: { limit: number; offset: number },
  ) => Promise<AnalyticsInteraction[]>;
  countInteractions: (filter: AnalyticsInteractionFilter) => Promise<number>;
  getConversationDetail: (
    conversationId: string,
    tenantId?: string,
  ) => Promise<AnalyticsConversation | null>;
  /** Fire-and-forget audit recorder; logs the fact of reading raw content. */
  recordAudit: (event: AuditLogInput) => void;
}

/** Upper bound on the search term length (escaped regex; bounds scan cost). */
const MAX_SEARCH_LEN = 200;

/** Parses an ISO/epoch date string, returning null when invalid. */
function parseDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Normalizes an Express query value to a single string (first element of an array). */
function firstString(value: ServerRequest['query'][string]): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }
  return undefined;
}

function toIso(value?: Date): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

function toInteraction(row: AnalyticsInteraction): AdminInteraction {
  return { ...row, createdAt: toIso(row.createdAt) };
}

function toConversationDetail(detail: AnalyticsConversation): AdminConversationDetail {
  return {
    ...detail,
    messages: detail.messages.map((m) => ({ ...m, createdAt: toIso(m.createdAt) })),
  };
}

export function createAdminAnalyticsHandlers(deps: AdminAnalyticsDeps) {
  const { listInteractions, countInteractions, getConversationDetail, recordAudit } = deps;

  async function listInteractionsHandler(req: ServerRequest, res: Response) {
    try {
      const { limit, offset } = parsePagination(req.query);
      const filter: AnalyticsInteractionFilter = {};

      // Tenant isolation: scope to the admin's tenant (no-op in single-tenant).
      if (req.user?.tenantId) {
        filter.tenantId = req.user.tenantId;
      }

      const userId = firstString(req.query.userId);
      if (userId) {
        if (!isValidObjectIdString(userId)) {
          return res.status(400).json({ error: 'Invalid userId format' });
        }
        filter.userId = userId;
      }

      const agentId = firstString(req.query.agentId);
      if (agentId) {
        filter.agentId = agentId;
      }

      const model = firstString(req.query.model);
      if (model) {
        filter.model = model;
      }

      const endpoint = firstString(req.query.endpoint);
      if (endpoint) {
        filter.endpoint = endpoint;
      }

      const search = firstString(req.query.q);
      if (search) {
        filter.search = search.slice(0, MAX_SEARCH_LEN);
      }

      const fromRaw = firstString(req.query.from);
      if (fromRaw) {
        const from = parseDate(fromRaw);
        if (!from) {
          return res.status(400).json({ error: 'Invalid "from" date' });
        }
        filter.from = from;
      }

      const toRaw = firstString(req.query.to);
      if (toRaw) {
        const to = parseDate(toRaw);
        if (!to) {
          return res.status(400).json({ error: 'Invalid "to" date' });
        }
        filter.to = to;
      }

      const [interactions, total] = await Promise.all([
        listInteractions(filter, { limit, offset }),
        countInteractions(filter),
      ]);

      return res
        .status(200)
        .json({ interactions: interactions.map(toInteraction), total, limit, offset });
    } catch (error) {
      logger.error('[adminAnalytics] listInteractions error:', error);
      return res.status(500).json({ error: 'Failed to list interactions' });
    }
  }

  async function getConversationHandler(req: ServerRequest, res: Response) {
    try {
      const { conversationId } = req.params as { conversationId: string };
      if (!conversationId) {
        return res.status(400).json({ error: 'conversationId is required' });
      }

      const detail = await getConversationDetail(conversationId, req.user?.tenantId);
      if (!detail) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      const actorId = req.user?._id?.toString() ?? req.user?.id;
      recordAudit({
        actorId,
        actorEmail: req.user?.email,
        actorRole: req.user?.role,
        action: 'conversation.read',
        targetType: 'conversation',
        targetId: conversationId,
        conversationId,
        metadata: { viewedUser: detail.userId ?? '' },
        ...auditRequestContext(req),
      });

      return res.status(200).json({ conversation: toConversationDetail(detail) });
    } catch (error) {
      logger.error('[adminAnalytics] getConversation error:', error);
      return res.status(500).json({ error: 'Failed to load conversation' });
    }
  }

  return {
    listInteractions: listInteractionsHandler,
    getConversation: getConversationHandler,
  };
}
