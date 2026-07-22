import type { Document, Types } from 'mongoose';

export type AuditAction =
  | 'auth.login'
  | 'auth.logout'
  | 'auth.login_failed'
  | 'llm.message'
  | 'file.upload'
  | 'file.access'
  | 'file.cite'
  | 'file.delete'
  | 'agent.invoke'
  | 'conversation.read'
  | 'conversation.search'
  | 'conversation.export'
  | 'permission.grant'
  | 'permission.revoke'
  | 'admin.config_change'
  | 'deep_research.set_active_mode'
  | 'deep_research.set_models'
  | 'apikey.create'
  | 'apikey.revoke'
  | 'billing.package_added'
  | 'billing.adjustment_added'
  | 'billing.threshold_80'
  | 'billing.exhausted'
  | 'billing.reconcile_alert'
  | 'billing.limit_updated';

export type AuditOutcome = 'success' | 'failure';

export interface IAuditTokens {
  input?: number;
  output?: number;
  total?: number;
}

export interface IAuditLog extends Omit<Document, 'model'> {
  tenantId?: string;
  actorId?: Types.ObjectId;
  actorEmail?: string;
  actorRole?: string;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  conversationId?: string;
  messageId?: string;
  model?: string;
  tokens?: IAuditTokens;
  ip?: string;
  userAgent?: string;
  outcome: AuditOutcome;
  metadata?: Record<string, string | number | boolean>;
  /** Stable id of the source record (e.g. transaction _id) — makes backfill idempotent. */
  sourceId?: string;
  createdAt: Date;
}

/** Plain input for creating an audit entry (no Mongoose Document fields). */
export interface AuditLogInput {
  tenantId?: string;
  actorId?: Types.ObjectId | string;
  actorEmail?: string;
  actorRole?: string;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  conversationId?: string;
  messageId?: string;
  model?: string;
  tokens?: IAuditTokens;
  ip?: string;
  userAgent?: string;
  outcome?: AuditOutcome;
  metadata?: Record<string, string | number | boolean>;
  sourceId?: string;
  createdAt?: Date;
}

/** Filter accepted by the audit read methods. */
export interface AuditLogFilter {
  tenantId?: string;
  actorId?: string;
  action?: string;
  conversationId?: string;
  from?: Date;
  to?: Date;
}
