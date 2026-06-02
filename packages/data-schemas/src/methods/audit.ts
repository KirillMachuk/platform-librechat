import logger from '~/config/winston';
import type { FilterQuery, Model } from 'mongoose';
import type { IAuditLog, AuditLogInput, AuditLogFilter } from '~/types';
import type { ITransaction } from '~/schema/transaction';

export interface BackfillResult {
  scanned: number;
  inserted: number;
}

const DUP_KEY_CODE = 11000;

export function createAuditMethods(mongoose: typeof import('mongoose')) {
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
  }): Promise<BackfillResult> {
    const AuditLog = mongoose.models.AuditLog as Model<IAuditLog>;
    const Transaction = mongoose.models.Transaction as Model<ITransaction>;

    const match: FilterQuery<ITransaction> = { tokenType: { $in: ['prompt', 'completion'] } };
    if (params?.tenantId) {
      match.tenantId = params.tenantId;
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
      await AuditLog.insertMany(docs, { ordered: false, timestamps: false });
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code !== DUP_KEY_CODE) {
        logger.error('[audit] backfill insert error:', error);
        throw error;
      }
    }

    return { scanned: txns.length, inserted: docs.length };
  }

  return { recordAuditLog, getAuditLogs, countAuditLogs, backfillAuditFromTransactions };
}

export type AuditMethods = ReturnType<typeof createAuditMethods>;
