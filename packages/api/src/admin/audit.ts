import { logger, isValidObjectIdString } from '@librechat/data-schemas';
import type { IAuditLog, AuditLogFilter, AdminAuditEntry } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import { parsePagination } from './pagination';

/**
 * Journal entries that belong to 1ma's own accounting, not to the client's.
 *
 * They are written by the reconciler, and their metadata carries the internals the client
 * contractually never sees: DOLLAR limits on the external key, the ledger-vs-OpenRouter
 * comparison, the journal-vs-counter drift in micro-dollars. The «Расходы» screen was
 * already careful about this; the «Аудит» screen renders every entry it is given, with
 * unknown metadata keys printed under their raw names — so the gate has to live here,
 * where the entries are fetched, and not in the UI that draws them.
 */
export const OPERATOR_ONLY_AUDIT_ACTIONS = [
  'billing.reconcile_alert',
  'billing.internal_drift',
  'billing.limit_updated',
] as const;

export interface AdminAuditDeps {
  /** Emails that may see 1ma's own accounting entries; everyone else gets them filtered out. */
  operatorEmails?: string[];
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
    userAgent: entry.userAgent,
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
  const operatorEmails = (deps.operatorEmails ?? []).map((email) => email.toLowerCase());

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

      const email = req.user?.email?.toLowerCase();
      if (!email || !operatorEmails.includes(email)) {
        filter.excludeActions = [...OPERATOR_ONLY_AUDIT_ACTIONS];
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
