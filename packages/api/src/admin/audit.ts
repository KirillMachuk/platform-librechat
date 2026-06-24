import { logger, isValidObjectIdString } from '@librechat/data-schemas';
import type { IAuditLog, AuditLogFilter, AdminAuditEntry } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import { parsePagination } from './pagination';

export interface AdminAuditDeps {
  getAuditLogs: (
    filter: AuditLogFilter,
    options: { limit: number; offset: number },
  ) => Promise<IAuditLog[]>;
  countAuditLogs: (filter: AuditLogFilter) => Promise<number>;
  backfillAuditFromTransactions: (params?: {
    tenantId?: string;
    since?: Date;
  }) => Promise<{ scanned: number; inserted: number }>;
  backfillAgentInvokes: (params?: {
    tenantId?: string;
    since?: Date;
  }) => Promise<{ scanned: number; inserted: number }>;
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

function mapEntry(entry: IAuditLog): AdminAuditEntry {
  return {
    id: entry._id?.toString() ?? '',
    action: entry.action,
    actorId: entry.actorId?.toString(),
    actorEmail: entry.actorEmail,
    actorRole: entry.actorRole,
    targetType: entry.targetType,
    targetId: entry.targetId,
    conversationId: entry.conversationId,
    messageId: entry.messageId,
    model: entry.model,
    tokens: entry.tokens
      ? { input: entry.tokens.input, output: entry.tokens.output, total: entry.tokens.total }
      : undefined,
    ip: entry.ip,
    outcome: entry.outcome,
    metadata: entry.metadata,
    createdAt: entry.createdAt ? new Date(entry.createdAt).toISOString() : undefined,
  };
}

export function createAdminAuditHandlers(deps: AdminAuditDeps): {
  listAudit: (req: ServerRequest, res: Response) => Promise<Response>;
  backfillAudit: (req: ServerRequest, res: Response) => Promise<Response>;
} {
  const { getAuditLogs, countAuditLogs, backfillAuditFromTransactions, backfillAgentInvokes } =
    deps;

  async function listAuditHandler(req: ServerRequest, res: Response) {
    try {
      const { limit, offset } = parsePagination(req.query);

      const filter: AuditLogFilter = {};

      const actorId = firstString(req.query.actorId);
      if (actorId) {
        if (!isValidObjectIdString(actorId)) {
          return res.status(400).json({ error: 'Invalid actorId format' });
        }
        filter.actorId = actorId;
      }

      const action = firstString(req.query.action);
      if (action) {
        filter.action = action;
      }

      const conversationId = firstString(req.query.conversationId);
      if (conversationId) {
        filter.conversationId = conversationId;
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

      const [entries, total] = await Promise.all([
        getAuditLogs(filter, { limit, offset }),
        countAuditLogs(filter),
      ]);

      return res.status(200).json({ entries: entries.map(mapEntry), total, limit, offset });
    } catch (error) {
      logger.error('[adminAudit] listAudit error:', error);
      return res.status(500).json({ error: 'Failed to list audit log' });
    }
  }

  async function backfillAuditHandler(_req: ServerRequest, res: Response) {
    try {
      const [transactions, agents] = await Promise.all([
        backfillAuditFromTransactions(),
        backfillAgentInvokes(),
      ]);
      return res.status(200).json({
        scanned: transactions.scanned + agents.scanned,
        inserted: transactions.inserted + agents.inserted,
      });
    } catch (error) {
      logger.error('[adminAudit] backfillAudit error:', error);
      return res.status(500).json({ error: 'Failed to backfill audit log' });
    }
  }

  return {
    listAudit: listAuditHandler,
    backfillAudit: backfillAuditHandler,
  };
}
