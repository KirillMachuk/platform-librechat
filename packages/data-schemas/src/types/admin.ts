import type {
  PrincipalType,
  PrincipalModel,
  TCustomConfig,
  RefillIntervalUnit,
} from 'librechat-data-provider';
import type { SystemCapabilities } from '~/admin/capabilities';

/* ── Capability types ───────────────────────────────────────────────── */

/** Base capabilities derived from the SystemCapabilities constant. */
export type BaseSystemCapability = (typeof SystemCapabilities)[keyof typeof SystemCapabilities];

/** Principal types that can receive config overrides. */
export type ConfigAssignTarget = 'user' | 'group' | 'role';

/** Top-level keys of the configSchema from librechat.yaml. */
export type ConfigSection = string & keyof TCustomConfig;

/** Section-level config capabilities derived from configSchema keys. */
type ConfigSectionCapability = `manage:configs:${ConfigSection}` | `read:configs:${ConfigSection}`;

/** Principal-scoped config assignment capabilities. */
type ConfigAssignCapability = `assign:configs:${ConfigAssignTarget}`;

/**
 * Union of all valid capability strings:
 * - Base capabilities from SystemCapabilities
 * - Section-level config capabilities (manage:configs:<section>, read:configs:<section>)
 * - Config assignment capabilities (assign:configs:<user|group|role>)
 */
export type SystemCapability =
  | BaseSystemCapability
  | ConfigSectionCapability
  | ConfigAssignCapability;

/** UI grouping of capabilities for the admin panel's capability editor. */
export type CapabilityCategory = {
  key: string;
  labelKey: string;
  capabilities: BaseSystemCapability[];
};

/* ── Admin API response types ───────────────────────────────────────── */

/** Config document as returned by the admin API (no Mongoose internals). */
export type AdminConfig = {
  _id: string;
  principalType: PrincipalType;
  principalId: string;
  principalModel: PrincipalModel;
  priority: number;
  overrides: Partial<TCustomConfig>;
  isActive: boolean;
  configVersion: number;
  tenantId?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type AdminConfigListResponse = {
  configs: AdminConfig[];
};

export type AdminConfigResponse = {
  config: AdminConfig;
};

export type AdminConfigDeleteResponse = {
  success: boolean;
};

/** Audit action types for grant changes (admin panel). Distinct from the broader
 *  system {@link AuditAction} in ./audit — kept separate to avoid an ambiguous re-export. */
export type AdminAuditAction = 'grant_assigned' | 'grant_removed';

/** SystemGrant document as returned by the admin API. */
export type AdminSystemGrant = {
  id: string;
  principalType: PrincipalType;
  principalId: string;
  capability: string;
  grantedBy?: string;
  grantedAt: string;
  expiresAt?: string;
};

/** Audit log entry for grant changes as returned by the admin API. */
export type AdminAuditLogEntry = {
  id: string;
  action: AdminAuditAction;
  actorId: string;
  actorName: string;
  targetPrincipalType: PrincipalType;
  targetPrincipalId: string;
  targetName: string;
  capability: string;
  timestamp: string;
};

/** Group as returned by the admin API. */
export type AdminGroup = {
  id: string;
  name: string;
  description: string;
  memberCount: number;
  topMembers: { name: string }[];
  isActive: boolean;
};

/** Member entry as returned by the admin API for group/role membership lists. */
export type AdminMember = {
  userId: string;
  name: string;
  email: string;
  avatarUrl?: string;
  joinedAt?: string;
};

/** Full user info returned by the admin user list endpoint. */
export type AdminUserListItem = {
  id: string;
  name: string;
  username: string;
  email: string;
  avatar: string;
  role: string;
  provider: string;
  disabled?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

/** A user's token balance and auto-refill settings, as returned by the admin balance endpoint. */
export type AdminUserBalance = {
  userId: string;
  /** Raw token credits (1,000,000 credits = $1). */
  tokenCredits: number;
  /** Convenience conversion of `tokenCredits` to USD. */
  balanceUsd: number;
  autoRefillEnabled: boolean;
  refillIntervalValue: number;
  refillIntervalUnit: RefillIntervalUnit;
  refillAmount: number;
  lastRefill?: string;
};

/** Per-user spend aggregate over a time window (raw output of the usage aggregation). */
export type UserUsageAggregate = {
  userId: string;
  email?: string;
  name?: string;
  /** Absolute token count spent (sum of debit transactions). */
  totalTokens: number;
  /** Absolute credits spent (1,000,000 credits = $1). */
  totalCredits: number;
};

/** A usage row as returned by the admin usage endpoint — adds the USD view. */
export type AdminUsageRow = UserUsageAggregate & {
  totalUsd: number;
};

/** The admin usage report for a resolved [from, to) window. */
export type AdminUsageReport = {
  from: string;
  to: string;
  rows: AdminUsageRow[];
};

/** A single audit-log entry as returned by the admin audit endpoint. */
export type AdminAuditEntry = {
  id: string;
  action: string;
  actorId?: string;
  actorEmail?: string;
  actorRole?: string;
  targetType?: string;
  targetId?: string;
  conversationId?: string;
  messageId?: string;
  model?: string;
  tokens?: { input?: number; output?: number; total?: number };
  ip?: string;
  outcome: string;
  /** Action-specific detail (e.g. DR mode + chosen models, granted capability). */
  metadata?: Record<string, string | number | boolean>;
  createdAt?: string;
};

/** Minimal user info returned by user search endpoints. */
export type AdminUserSearchResult = {
  id: string;
  name: string;
  email: string;
  username?: string;
  avatarUrl?: string;
};

/* ── AI usage analytics types ───────────────────────────────────────── */

/** Filter accepted by the analytics interaction read methods. */
export type AnalyticsInteractionFilter = {
  tenantId?: string;
  /** Filter by employee (`messages.user`). */
  userId?: string;
  /** Filter by agent (`conversations.agent_id`). */
  agentId?: string;
  /** Pre-resolved conversation ids (e.g. from an agent lookup) to scope the feed to. */
  conversationIds?: string[];
  model?: string;
  endpoint?: string;
  /** Case-insensitive substring search over the request text. */
  search?: string;
  from?: Date;
  to?: Date;
};

/** A single employee↔AI request row (method output — truncated preview + Date). */
export type AnalyticsInteraction = {
  messageId: string;
  conversationId: string;
  userId: string;
  userEmail?: string;
  userName?: string;
  /** Resolved model (parsed from an ephemeral agent id / message / conversation). */
  model?: string;
  endpoint?: string;
  /** Display name of a real (named) agent; absent for plain model chats. */
  agentName?: string;
  conversationTitle?: string;
  /** Truncated request text. */
  preview: string;
  createdAt: Date;
};

/** A single export row (method output) — like a feed row but with the FULL request text. */
export type AnalyticsExportRow = {
  createdAt: Date;
  userId: string;
  userEmail?: string;
  userName?: string;
  model?: string;
  agentName?: string;
  /** Full request text (not truncated). */
  text: string;
};

/** A single message within a full conversation (method output). */
export type AnalyticsConversationMessage = {
  messageId: string;
  parentMessageId?: string | null;
  isCreatedByUser: boolean;
  sender?: string;
  /** Resolved text (falls back to text content parts). */
  text: string;
  model?: string;
  endpoint?: string;
  createdAt?: Date;
};

/** A full conversation with its messages (method output). */
export type AnalyticsConversation = {
  conversationId: string;
  title?: string;
  /** Resolved model for the conversation (ephemeral-agent / conversation). */
  model?: string;
  /** Display name of a real (named) agent; absent for plain model chats. */
  agentName?: string;
  userId?: string;
  userEmail?: string;
  userName?: string;
  messages: AnalyticsConversationMessage[];
  /** True when the message list was capped (more turns exist than returned). */
  truncated: boolean;
};

/** A single interaction row as returned by the admin analytics endpoint (ISO date). */
export type AdminInteraction = Omit<AnalyticsInteraction, 'createdAt'> & {
  createdAt?: string;
};

/** The admin analytics interaction list response. Uses `hasMore` (cheap over-fetch)
 * instead of an exact total to avoid a full count scan on every page at scale. */
export type AdminInteractionList = {
  interactions: AdminInteraction[];
  hasMore: boolean;
  limit: number;
  offset: number;
};

/** A single conversation message as returned by the admin analytics endpoint (ISO date). */
export type AdminConversationMessage = Omit<AnalyticsConversationMessage, 'createdAt'> & {
  createdAt?: string;
};

/** A full conversation as returned by the admin analytics endpoint. */
export type AdminConversationDetail = Omit<AnalyticsConversation, 'messages'> & {
  messages: AdminConversationMessage[];
};
