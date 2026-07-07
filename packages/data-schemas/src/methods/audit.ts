import type { FilterQuery, Model, InsertManyOptions } from 'mongoose';
import type { IAuditLog, AuditLogInput, AuditLogFilter } from '~/types';
import type { ITransaction } from '~/schema/transaction';
import logger from '~/config/winston';

export interface BackfillResult {
  scanned: number;
  inserted: number;
}

const DUP_KEY_CODE = 11000;

/**
 * Backfill inserts carry their own historical `createdAt`; `timestamps: false`
 * stops the schema's `createdAt` hook from overwriting it. mongoose honors the
 * option at runtime but omits it from InsertManyOptions (v8.23), so the type is
 * widened here rather than asserted at each call site.
 */
const BACKFILL_INSERT_OPTIONS: InsertManyOptions & { timestamps: boolean } = {
  ordered: false,
  timestamps: false,
};
const OBJECT_ID = /^[a-f0-9]{24}$/i;

/** Projected shape of a user message sent in an agent conversation. */
interface AgentInvokeRow {
  messageId: string;
  user: string;
  conversationId: string;
  agentId: string;
  model?: string;
  tenantId?: string;
  createdAt: Date;
}

export interface AuditMethods {
  recordAuditLog(event: AuditLogInput): Promise<IAuditLog>;
  getAuditLogs(
    filter: AuditLogFilter,
    options: { limit: number; offset: number },
  ): Promise<IAuditLog[]>;
  countAuditLogs(filter: AuditLogFilter): Promise<number>;
  backfillAuditFromTransactions(params?: {
    tenantId?: string;
    since?: Date;
  }): Promise<BackfillResult>;
  backfillAgentInvokes(params?: { tenantId?: string; since?: Date }): Promise<BackfillResult>;
}

export function createAuditMethods(mongoose: typeof import('mongoose')): AuditMethods {
  function buildQuery(filter: AuditLogFilter): FilterQuery<IAuditLog> {
    const query: FilterQuery<IAuditLog> = {};
    if (filter.tenantId) {
      query.tenantId = filter.tenantId;
    }
    if (filter.actorId) {
      query.actorId = filter.actorId;
    }
    if (filter.action) {
      query.action = filter.action;
    }
    if (filter.conversationId) {
      query.conversationId = filter.conversationId;
    }
    if (filter.from || filter.to) {
      const createdAt: { $gte?: Date; $lt?: Date } = {};
      if (filter.from) {
        createdAt.$gte = filter.from;
      }
      if (filter.to) {
        createdAt.$lt = filter.to;
      }
      query.createdAt = createdAt;
    }
    return query;
  }

  /** Appends a single audit entry. */
  async function recordAuditLog(event: AuditLogInput): Promise<IAuditLog> {
    const AuditLog = mongoose.models.AuditLog as Model<IAuditLog>;
    return AuditLog.create({ ...event, outcome: event.outcome ?? 'success' });
  }

  /** Reads a page of audit entries (newest first) for the given filter. */
  async function getAuditLogs(
    filter: AuditLogFilter,
    options: { limit: number; offset: number },
  ): Promise<IAuditLog[]> {
    const AuditLog = mongoose.models.AuditLog as Model<IAuditLog>;
    return AuditLog.find(buildQuery(filter))
      .sort({ createdAt: -1 })
      .skip(options.offset)
      .limit(options.limit)
      .lean<IAuditLog[]>();
  }

  async function countAuditLogs(filter: AuditLogFilter): Promise<number> {
    const AuditLog = mongoose.models.AuditLog as Model<IAuditLog>;
    return AuditLog.countDocuments(buildQuery(filter));
  }

  /**
   * Idempotently derives `llm.message` audit entries from existing spend
   * transactions, preserving each transaction's original timestamp. Re-runnable:
   * entries already present (matched by `sourceId`) are skipped.
   */
  async function backfillAuditFromTransactions(params?: {
    tenantId?: string;
    since?: Date;
  }): Promise<BackfillResult> {
    const AuditLog = mongoose.models.AuditLog as Model<IAuditLog>;
    const Transaction = mongoose.models.Transaction as Model<ITransaction>;

    const match: FilterQuery<ITransaction> = { tokenType: { $in: ['prompt', 'completion'] } };
    if (params?.tenantId) {
      match.tenantId = params.tenantId;
    }
    if (params?.since) {
      match.createdAt = { $gte: params.since };
    }

    const txns = await Transaction.find(match)
      .select('_id user conversationId messageId model tokenType rawAmount tenantId createdAt')
      .lean<ITransaction[]>();

    if (!txns.length) {
      return { scanned: 0, inserted: 0 };
    }

    const sourceIds = txns.map((t) => t._id?.toString()).filter((id): id is string => Boolean(id));
    const existing = await AuditLog.find({ sourceId: { $in: sourceIds } })
      .select('sourceId')
      .lean<{ sourceId?: string }[]>();
    const seen = new Set(existing.map((e) => e.sourceId));

    const docs: AuditLogInput[] = txns
      .filter((t) => !seen.has(t._id?.toString()))
      .map((t) => {
        const total = Math.abs(t.rawAmount ?? 0);
        return {
          tenantId: t.tenantId,
          actorId: t.user,
          action: 'llm.message',
          targetType: 'conversation',
          targetId: t.conversationId,
          conversationId: t.conversationId,
          messageId: t.messageId,
          model: t.model,
          tokens: {
            input: t.tokenType === 'prompt' ? total : 0,
            output: t.tokenType === 'completion' ? total : 0,
            total,
          },
          outcome: 'success',
          sourceId: t._id?.toString(),
          createdAt: t.createdAt,
        };
      });

    if (!docs.length) {
      return { scanned: txns.length, inserted: 0 };
    }

    try {
      await AuditLog.insertMany(docs, BACKFILL_INSERT_OPTIONS);
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code !== DUP_KEY_CODE) {
        logger.error('[audit] backfill insert error:', error);
        throw error;
      }
    }

    return { scanned: txns.length, inserted: docs.length };
  }

  /**
   * Idempotently derives `agent.invoke` audit entries from user messages sent in
   * agent conversations (the conversation has an `agent_id`). Preserves each
   * message's timestamp and is re-runnable via the `agent:<messageId>` sourceId.
   * Pass `since` to scan only recent messages (used by the scheduled backfill).
   */
  async function backfillAgentInvokes(params?: {
    tenantId?: string;
    since?: Date;
  }): Promise<BackfillResult> {
    const AuditLog = mongoose.models.AuditLog as Model<IAuditLog>;
    const Message = mongoose.models.Message;

    const match: { isCreatedByUser: boolean; tenantId?: string; createdAt?: { $gte: Date } } = {
      isCreatedByUser: true,
    };
    if (params?.tenantId) {
      match.tenantId = params.tenantId;
    }
    if (params?.since) {
      match.createdAt = { $gte: params.since };
    }

    const rows = await Message.aggregate<AgentInvokeRow>([
      { $match: match },
      {
        $lookup: {
          from: 'conversations',
          localField: 'conversationId',
          foreignField: 'conversationId',
          as: 'convo',
        },
      },
      { $unwind: '$convo' },
      { $match: { 'convo.agent_id': { $nin: [null, ''] } } },
      {
        $project: {
          _id: 0,
          messageId: 1,
          user: 1,
          conversationId: 1,
          agentId: '$convo.agent_id',
          model: 1,
          tenantId: 1,
          createdAt: 1,
        },
      },
    ]);

    if (!rows.length) {
      return { scanned: 0, inserted: 0 };
    }

    const sourceIds = rows.map((r) => `agent:${r.messageId}`);
    const existing = await AuditLog.find({ sourceId: { $in: sourceIds } })
      .select('sourceId')
      .lean<{ sourceId?: string }[]>();
    const seen = new Set(existing.map((e) => e.sourceId));

    const docs: AuditLogInput[] = rows
      .filter(
        (r) =>
          typeof r.user === 'string' && OBJECT_ID.test(r.user) && !seen.has(`agent:${r.messageId}`),
      )
      .map((r) => ({
        tenantId: r.tenantId,
        actorId: r.user,
        action: 'agent.invoke',
        targetType: 'agent',
        targetId: r.agentId,
        conversationId: r.conversationId,
        messageId: r.messageId,
        model: r.model ?? undefined,
        outcome: 'success',
        sourceId: `agent:${r.messageId}`,
        createdAt: r.createdAt,
      }));

    if (!docs.length) {
      return { scanned: rows.length, inserted: 0 };
    }

    try {
      await AuditLog.insertMany(docs, BACKFILL_INSERT_OPTIONS);
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code !== DUP_KEY_CODE) {
        logger.error('[audit] agent-invoke backfill insert error:', error);
        throw error;
      }
    }

    return { scanned: rows.length, inserted: docs.length };
  }

  return {
    recordAuditLog,
    getAuditLogs,
    countAuditLogs,
    backfillAuditFromTransactions,
    backfillAgentInvokes,
  };
}
