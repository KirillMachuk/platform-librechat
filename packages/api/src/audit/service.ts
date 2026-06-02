import { logger } from '@librechat/data-schemas';
import type { AuditLogInput } from '@librechat/data-schemas';

export interface AuditRecorderDeps {
  recordAuditLog: (event: AuditLogInput) => Promise<unknown>;
}

export interface AuditRequestLike {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
}

/** Extracts ip + user-agent from an Express-like request for audit context. */
export function auditRequestContext(req?: AuditRequestLike): { ip?: string; userAgent?: string } {
  if (!req) {
    return {};
  }
  const ua = req.headers?.['user-agent'];
  return { ip: req.ip, userAgent: typeof ua === 'string' ? ua : undefined };
}

export function createAuditRecorder(deps: AuditRecorderDeps) {
  /**
   * Fire-and-forget audit write. Never throws into the caller and never blocks
   * the request — an audit failure must not break the action being audited.
   */
  function recordAudit(event: AuditLogInput): void {
    Promise.resolve()
      .then(() => deps.recordAuditLog(event))
      .catch((error) => {
        logger.warn(`[audit] failed to record "${event.action}"`, error);
      });
  }

  return { recordAudit };
}

export interface BackfillCounts {
  scanned: number;
  inserted: number;
}

export interface AuditBackfillDeps {
  backfillAuditFromTransactions: (params?: { since?: Date }) => Promise<BackfillCounts>;
  backfillAgentInvokes: (params?: { since?: Date }) => Promise<BackfillCounts>;
}

export function createAuditBackfiller(deps: AuditBackfillDeps) {
  /**
   * Runs an incremental backfill over the trailing `lookbackMs` window: derives
   * `llm.message` (from transactions) and `agent.invoke` (from messages) entries
   * created since then. The overlap is harmless — both derivations dedupe by
   * sourceId. Never throws; returns zeroed counts on failure so a scheduler can
   * keep ticking.
   */
  async function runBackfill(opts: { now: number; lookbackMs: number }): Promise<BackfillCounts> {
    const since = new Date(opts.now - opts.lookbackMs);
    try {
      const [transactions, agents] = await Promise.all([
        deps.backfillAuditFromTransactions({ since }),
        deps.backfillAgentInvokes({ since }),
      ]);
      const result = {
        scanned: transactions.scanned + agents.scanned,
        inserted: transactions.inserted + agents.inserted,
      };
      if (result.inserted > 0) {
        logger.info(
          `[audit] scheduled backfill: +${result.inserted} of ${result.scanned} since ${since.toISOString()}`,
        );
      }
      return result;
    } catch (error) {
      logger.warn('[audit] scheduled backfill failed', error);
      return { scanned: 0, inserted: 0 };
    }
  }

  return { runBackfill };
}
