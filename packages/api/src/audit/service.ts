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
