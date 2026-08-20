import { logger, MICRO_USD_PER_USD } from '@librechat/data-schemas';
import type {
  AdminUsageReport,
  AdminUsageRow,
  CreditSpendByUser,
  UserUsageAggregate,
} from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 366;

export interface AdminUsageDeps {
  /**
   * Token journal aggregate. Supplies TOKENS only — its `totalCredits` is
   * tokens × a local rate table and is not money (see {@link createAdminUsageHandlers}).
   */
  aggregateUsageByUser: (params: {
    start: Date;
    end: Date;
    tenantId?: string;
  }) => Promise<UserUsageAggregate[]>;
  /** Actual per-request cost from the credit ledger — the money source. */
  aggregateCreditSpendByUser: (params: {
    start: Date;
    end: Date;
    tenantId?: string;
  }) => Promise<CreditSpendByUser>;
}

/** Parses an ISO/epoch date string, returning null when invalid. */
function parseDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Merges the ledger's actual cost with the journal's token counts into one row per
 * user. Keyed by user id; a user present in only one source keeps the other side at
 * zero rather than being dropped, so a gap in either feed stays visible.
 */
function buildRows(spend: CreditSpendByUser, tokens: UserUsageAggregate[]): AdminUsageRow[] {
  const tokensByUser = new Map(tokens.map((row) => [row.userId, row]));
  const rows: AdminUsageRow[] = spend.rows.map((row) => {
    const journal = tokensByUser.get(row.userId);
    tokensByUser.delete(row.userId);
    return {
      userId: row.userId,
      email: row.email ?? journal?.email,
      name: row.name ?? journal?.name,
      totalTokens: journal?.totalTokens ?? 0,
      totalCredits: row.microUsd,
      totalUsd: row.microUsd / MICRO_USD_PER_USD,
    };
  });

  for (const journal of tokensByUser.values()) {
    rows.push({
      userId: journal.userId,
      email: journal.email,
      name: journal.name,
      totalTokens: journal.totalTokens,
      totalCredits: 0,
      totalUsd: 0,
    });
  }

  return rows.sort((a, b) => b.totalCredits - a.totalCredits || b.totalTokens - a.totalTokens);
}

/**
 * Admin «Расходы» → «Кто сколько потратил».
 *
 * Money comes from the credit ledger (`creditspends`), i.e. the cost OpenRouter
 * actually charged for each request, reported by the anonymizer — the same source
 * as the tenant total shown above the table. It is NOT derived from the token
 * journal: `transactions.tokenValue` is tokens × a rate table baked into the image,
 * which is wrong by construction — one slug costs different money on different
 * platforms (measured 20.08.2026: two calls to the same model minutes apart cost
 * $1.22e-6 and $2.24e-6), some tariffs float by time of day, and any table has to be
 * hand-edited whenever a provider moves a price. Measured on the stand for August
 * 2026, that table put the employee column at $1.46 while the tenant total (actual)
 * was $2.97 — the same screen contradicting itself by 2x.
 *
 * Tokens still come from the journal: a token count is a count, not a price, and the
 * ledger does not carry one.
 */
export function createAdminUsageHandlers(deps: AdminUsageDeps): {
  getUsage: (req: ServerRequest, res: Response) => Promise<Response>;
} {
  const { aggregateUsageByUser, aggregateCreditSpendByUser } = deps;

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

      const [spend, tokens] = await Promise.all([
        aggregateCreditSpendByUser({ start: from, end: to }),
        aggregateUsageByUser({ start: from, end: to }),
      ]);

      const report: AdminUsageReport = {
        from: from.toISOString(),
        to: to.toISOString(),
        rows: buildRows(spend, tokens),
        unattributedCredits: spend.unattributedMicroUsd,
        unattributedUsd: spend.unattributedMicroUsd / MICRO_USD_PER_USD,
        unattributedRequests: spend.unattributedRequests,
      };

      return res.status(200).json(report);
    } catch (error) {
      logger.error('[adminUsage] getUsage error:', error);
      return res.status(500).json({ error: 'Failed to get usage' });
    }
  }

  return {
    getUsage: getUsageHandler,
  };
}
