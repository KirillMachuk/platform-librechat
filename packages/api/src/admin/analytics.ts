import { logger, isValidObjectIdString } from '@librechat/data-schemas';
import type {
  AuditLogInput,
  AdminInteraction,
  AnalyticsExportRow,
  AnalyticsConversation,
  AnalyticsInteraction,
  AdminConversationDetail,
  AnalyticsInteractionFilter,
} from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import { auditRequestContext } from '~/audit/service';
import { parsePagination } from './pagination';

/** Upper bound on the search term length (escaped regex; bounds scan cost). */
const MAX_SEARCH_LEN = 200;
/** Reject pathological deep-paging that would force an unbounded $skip walk. */
const MAX_OFFSET = 100000;
/** Safety cap on rows returned by a single CSV export. */
const MAX_EXPORT_ROWS = 50000;
/** CSV header row — mirrors the visible feed columns. */
const EXPORT_HEADERS = ['Время', 'Сотрудник', 'Email', 'Модель/агент', 'Запрос'];

export interface AdminAnalyticsDeps {
  listInteractions: (
    filter: AnalyticsInteractionFilter,
    options: { limit: number; offset: number },
  ) => Promise<{ interactions: AnalyticsInteraction[]; hasMore: boolean }>;
  exportInteractions: (
    filter: AnalyticsInteractionFilter,
    options: { limit: number },
  ) => Promise<AnalyticsExportRow[]>;
  getConversationDetail: (
    conversationId: string,
    tenantId?: string,
  ) => Promise<AnalyticsConversation | null>;
  resolveAgentConversationIds: (agentId: string, tenantId?: string) => Promise<string[]>;
  /** Fire-and-forget audit recorder; logs the fact of reading raw content. */
  recordAudit: (event: AuditLogInput) => void;
}

/** MongoDB error code for a query that exceeded its maxTimeMS budget. */
const MONGO_MAX_TIME_EXPIRED = 50;

/** True when an error is a query-time-budget expiry (expected on a too-broad query, not a fault). */
function isQueryTimeout(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: number }).code === MONGO_MAX_TIME_EXPIRED
  );
}

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

/** Escapes a CSV cell (RFC 4180): quote when it contains a comma/quote/newline. */
function csvCell(value: string): string {
  return /["\n\r,]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Renders export rows as a UTF-8 CSV (BOM so Excel reads Cyrillic; CRLF line endings). */
function buildCsv(rows: AnalyticsExportRow[]): string {
  const lines = [EXPORT_HEADERS.join(',')];
  for (const r of rows) {
    const modelAgent = r.agentName ? `${r.model ?? ''} · агент: ${r.agentName}` : (r.model ?? '');
    lines.push(
      [
        r.createdAt ? new Date(r.createdAt).toISOString() : '',
        r.userName ?? '',
        r.userEmail ?? '',
        modelAgent,
        r.text ?? '',
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return '\uFEFF' + lines.join('\r\n');
}

/** Builds the (PII-free except the admin's own query terms) audit metadata for a feed access. */
function buildSearchMeta(
  filter: AnalyticsInteractionFilter,
  agentId: string | undefined,
  results: number,
): Record<string, string | number | boolean> {
  const meta: Record<string, string | number | boolean> = { results };
  if (filter.userId) {
    meta.userId = filter.userId;
  }
  if (agentId) {
    meta.agentId = agentId;
  }
  if (filter.model) {
    meta.model = filter.model;
  }
  if (filter.endpoint) {
    meta.endpoint = filter.endpoint;
  }
  if (filter.search) {
    meta.search = filter.search;
  }
  const from = toIso(filter.from);
  if (from) {
    meta.from = from;
  }
  const to = toIso(filter.to);
  if (to) {
    meta.to = to;
  }
  return meta;
}

type ResolvedFilter =
  | { ok: true; filter: AnalyticsInteractionFilter; agentId?: string; empty: boolean }
  | { ok: false; status: number; message: string };

export function createAdminAnalyticsHandlers(deps: AdminAnalyticsDeps) {
  const {
    listInteractions,
    exportInteractions,
    getConversationDetail,
    resolveAgentConversationIds,
    recordAudit,
  } = deps;

  function actorFields(req: ServerRequest) {
    return {
      actorId: req.user?._id?.toString() ?? req.user?.id,
      actorEmail: req.user?.email,
      actorRole: req.user?.role,
    };
  }

  /**
   * Parses the shared feed/export query filters and resolves an agent filter to
   * conversation ids once. Returns `empty: true` when an agent has no
   * conversations (caller should short-circuit to an empty result).
   */
  async function resolveFilter(req: ServerRequest): Promise<ResolvedFilter> {
    const filter: AnalyticsInteractionFilter = {};

    // Tenant isolation: scope to the admin's tenant (no-op in single-tenant).
    if (req.user?.tenantId) {
      filter.tenantId = req.user.tenantId;
    }

    const userId = firstString(req.query.userId);
    if (userId) {
      if (!isValidObjectIdString(userId)) {
        return { ok: false, status: 400, message: 'Invalid userId format' };
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
        return { ok: false, status: 400, message: 'Invalid "from" date' };
      }
      filter.from = from;
    }

    const toRaw = firstString(req.query.to);
    if (toRaw) {
      const to = parseDate(toRaw);
      if (!to) {
        return { ok: false, status: 400, message: 'Invalid "to" date' };
      }
      filter.to = to;
    }

    if (agentId) {
      const conversationIds = await resolveAgentConversationIds(agentId, filter.tenantId);
      if (!conversationIds.length) {
        return { ok: true, filter, agentId, empty: true };
      }
      filter.conversationIds = conversationIds;
      delete filter.agentId;
    }

    return { ok: true, filter, agentId, empty: false };
  }

  async function listInteractionsHandler(req: ServerRequest, res: Response) {
    try {
      const { limit, offset } = parsePagination(req.query);
      if (offset > MAX_OFFSET) {
        return res.status(400).json({ error: `offset must not exceed ${MAX_OFFSET}` });
      }

      const resolved = await resolveFilter(req);
      if (!resolved.ok) {
        return res.status(resolved.status).json({ error: resolved.message });
      }
      const { filter, agentId, empty } = resolved;

      if (empty) {
        recordAudit({
          ...actorFields(req),
          action: 'conversation.search',
          targetType: 'analytics',
          metadata: buildSearchMeta(filter, agentId, 0),
          ...auditRequestContext(req),
        });
        return res.status(200).json({ interactions: [], hasMore: false, limit, offset });
      }

      const { interactions, hasMore } = await listInteractions(filter, { limit, offset });

      recordAudit({
        ...actorFields(req),
        action: 'conversation.search',
        targetType: 'analytics',
        metadata: buildSearchMeta(filter, agentId, interactions.length),
        ...auditRequestContext(req),
      });

      return res
        .status(200)
        .json({ interactions: interactions.map(toInteraction), hasMore, limit, offset });
    } catch (error) {
      if (isQueryTimeout(error)) {
        return res
          .status(503)
          .json({ error: 'Query timed out — narrow the date range or filters and try again' });
      }
      logger.error('[adminAnalytics] listInteractions error:', error);
      return res.status(500).json({ error: 'Failed to list interactions' });
    }
  }

  async function exportHandler(req: ServerRequest, res: Response) {
    try {
      const resolved = await resolveFilter(req);
      if (!resolved.ok) {
        return res.status(resolved.status).json({ error: resolved.message });
      }
      const { filter, agentId, empty } = resolved;

      const rows = empty ? [] : await exportInteractions(filter, { limit: MAX_EXPORT_ROWS });

      recordAudit({
        ...actorFields(req),
        action: 'conversation.export',
        targetType: 'analytics',
        metadata: buildSearchMeta(filter, agentId, rows.length),
        ...auditRequestContext(req),
      });

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="analytics-export.csv"');
      return res.status(200).send(buildCsv(rows));
    } catch (error) {
      if (isQueryTimeout(error)) {
        return res
          .status(503)
          .json({ error: 'Export timed out — narrow the date range or filters' });
      }
      logger.error('[adminAnalytics] export error:', error);
      return res.status(500).json({ error: 'Failed to export interactions' });
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

      recordAudit({
        ...actorFields(req),
        action: 'conversation.read',
        targetType: 'conversation',
        targetId: conversationId,
        conversationId,
        metadata: { viewedUser: detail.userId ?? '' },
        ...auditRequestContext(req),
      });

      return res.status(200).json({ conversation: toConversationDetail(detail) });
    } catch (error) {
      if (isQueryTimeout(error)) {
        return res.status(503).json({ error: 'Query timed out — try again' });
      }
      logger.error('[adminAnalytics] getConversation error:', error);
      return res.status(500).json({ error: 'Failed to load conversation' });
    }
  }

  return {
    listInteractions: listInteractionsHandler,
    export: exportHandler,
    getConversation: getConversationHandler,
  };
}
