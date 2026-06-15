import { logger } from '@librechat/data-schemas';
import type {
  AuditLogInput,
  IAnalyticsRun,
  IAnalyticsTopic,
  IAnalyticsAssignment,
} from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import { auditRequestContext } from '~/audit/service';
import { parsePagination } from './pagination';

/** Conversation summary as produced by the data layer (Date fields, pre-serialization). */
interface ConversationSummary {
  conversationId: string;
  title?: string;
  userId?: string;
  userEmail?: string;
  userName?: string;
  createdAt?: Date;
  preview: string;
}

export interface AdminTopicsDeps {
  getLatestAnalyticsRun: (filter: { tenantId?: string }) => Promise<IAnalyticsRun | null>;
  getRunTopics: (runId: unknown) => Promise<IAnalyticsTopic[]>;
  getTopicAssignments: (
    runId: unknown,
    topicKey: number,
    options: { limit: number; offset: number },
  ) => Promise<IAnalyticsAssignment[]>;
  getConversationSummaries: (
    conversationIds: string[],
    tenantId?: string,
  ) => Promise<ConversationSummary[]>;
  /** Triggers an on-demand recompute (optional — absent ⇒ the run endpoint 503s). */
  runTopicClustering?: (opts: { tenantId?: string }) => Promise<void>;
  recordAudit: (event: AuditLogInput) => void;
}

const MAX_TOPIC_KEY = 100000;

function toIso(value?: Date): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

function toRunDTO(run: IAnalyticsRun) {
  return {
    runId: String(run._id),
    generatedAt: toIso(run.createdAt),
    windowStart: toIso(run.windowStart),
    windowEnd: toIso(run.windowEnd),
    conversationCount: run.conversationCount ?? 0,
    topicCount: run.topicCount ?? 0,
    assignedCount: run.assignedCount ?? 0,
    noiseCount: run.noiseCount ?? 0,
  };
}

function toTopicDTO(topic: IAnalyticsTopic) {
  return {
    topicKey: topic.topicKey,
    label: topic.label,
    keywords: topic.keywords ?? [],
    size: topic.size,
    share: topic.share,
  };
}

function toSummaryDTO(summary: ConversationSummary) {
  return {
    conversationId: summary.conversationId,
    title: summary.title,
    userId: summary.userId,
    userEmail: summary.userEmail,
    userName: summary.userName,
    createdAt: toIso(summary.createdAt),
    preview: summary.preview,
  };
}

export function createAdminTopicsHandlers(deps: AdminTopicsDeps) {
  function actorFields(req: ServerRequest) {
    return {
      actorId: req.user?._id?.toString() ?? req.user?.id,
      actorEmail: req.user?.email,
      actorRole: req.user?.role,
    };
  }

  /** GET — the latest run's theme distribution (aggregate; no raw content). */
  async function getTopics(req: ServerRequest, res: Response) {
    try {
      const tenantId = req.user?.tenantId;
      const run = await deps.getLatestAnalyticsRun({ tenantId });
      if (!run) {
        return res.status(200).json({ run: null, topics: [] });
      }
      const topics = await deps.getRunTopics(run._id);
      return res.status(200).json({ run: toRunDTO(run), topics: topics.map(toTopicDTO) });
    } catch (error) {
      logger.error('[adminTopics] getTopics error:', error);
      return res.status(500).json({ error: 'Failed to load topics' });
    }
  }

  /** GET — a page of a theme's example conversations (title + first request preview). */
  async function getTopicConversations(req: ServerRequest, res: Response) {
    try {
      const topicKey = Number((req.params as { topicKey: string }).topicKey);
      if (!Number.isInteger(topicKey) || Math.abs(topicKey) > MAX_TOPIC_KEY) {
        return res.status(400).json({ error: 'Invalid topicKey' });
      }
      const { limit, offset } = parsePagination(req.query);
      const tenantId = req.user?.tenantId;

      const run = await deps.getLatestAnalyticsRun({ tenantId });
      if (!run) {
        return res.status(200).json({ conversations: [], hasMore: false, limit, offset });
      }
      const assignments = await deps.getTopicAssignments(run._id, topicKey, {
        limit: limit + 1,
        offset,
      });
      const hasMore = assignments.length > limit;
      const page = hasMore ? assignments.slice(0, limit) : assignments;
      const summaries = await deps.getConversationSummaries(
        page.map((a) => a.conversationId),
        tenantId,
      );

      // Drill-in surfaces conversation titles + request previews → audit the access.
      deps.recordAudit({
        ...actorFields(req),
        action: 'conversation.search',
        targetType: 'analytics',
        metadata: { topicKey, results: summaries.length },
        ...auditRequestContext(req),
      });

      return res
        .status(200)
        .json({ conversations: summaries.map(toSummaryDTO), hasMore, limit, offset });
    } catch (error) {
      logger.error('[adminTopics] getTopicConversations error:', error);
      return res.status(500).json({ error: 'Failed to load topic conversations' });
    }
  }

  /** POST — kick off an on-demand recompute (fire-and-forget; returns 202). */
  async function runTopics(req: ServerRequest, res: Response) {
    if (!deps.runTopicClustering) {
      return res.status(503).json({ error: 'Topic clustering is not configured' });
    }
    const tenantId = req.user?.tenantId;
    deps.recordAudit({
      ...actorFields(req),
      action: 'conversation.search',
      targetType: 'analytics',
      metadata: { trigger: 'topics_recompute' },
      ...auditRequestContext(req),
    });
    deps.runTopicClustering({ tenantId }).catch((error) => {
      logger.error('[adminTopics] manual recompute failed:', error);
    });
    return res.status(202).json({ status: 'started' });
  }

  return { getTopics, getTopicConversations, runTopics };
}
