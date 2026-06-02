import { logger } from '@librechat/data-schemas';
import type { UserUsageAggregate, AdminUsageRow } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import { TOKEN_CREDITS_PER_USD } from './balance';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 366;

export interface AdminUsageDeps {
  aggregateUsageByUser: (params: {
    start: Date;
    end: Date;
    tenantId?: string;
  }) => Promise<UserUsageAggregate[]>;
}

/** Parses an ISO/epoch date string, returning null when invalid. */
function parseDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toUsageRow(row: UserUsageAggregate): AdminUsageRow {
  return {
    ...row,
    totalUsd: row.totalCredits / TOKEN_CREDITS_PER_USD,
  };
}

export function createAdminUsageHandlers(deps: AdminUsageDeps) {
  const { aggregateUsageByUser } = deps;

  async function getUsageHandler(req: ServerRequest, res: Response) {
    try {
      const fromRaw = req.query.from;
      const toRaw = req.query.to;

      const to = typeof toRaw === 'string' && toRaw ? parseDate(toRaw) : new Date();
      if (!to) {
        return res.status(400).json({ error: 'Invalid "to" date' });
      }

      let from: Date | null;
      if (typeof fromRaw === 'string' && fromRaw) {
        from = parseDate(fromRaw);
        if (!from) {
          return res.status(400).json({ error: 'Invalid "from" date' });
        }
      } else {
        from = new Date(to.getTime() - DEFAULT_WINDOW_DAYS * DAY_MS);
      }

      if (from.getTime() >= to.getTime()) {
        return res.status(400).json({ error: '"from" must be before "to"' });
      }
      if (to.getTime() - from.getTime() > MAX_WINDOW_DAYS * DAY_MS) {
        return res.status(400).json({ error: `Window must not exceed ${MAX_WINDOW_DAYS} days` });
      }

      const aggregates = await aggregateUsageByUser({ start: from, end: to });
      const rows = aggregates.map(toUsageRow);

      return res.status(200).json({ from: from.toISOString(), to: to.toISOString(), rows });
    } catch (error) {
      logger.error('[adminUsage] getUsage error:', error);
      return res.status(500).json({ error: 'Failed to get usage' });
    }
  }

  return {
    getUsage: getUsageHandler,
  };
}
