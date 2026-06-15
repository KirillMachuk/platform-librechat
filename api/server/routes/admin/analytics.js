const express = require('express');
const {
  createAdminAnalyticsHandlers,
  createAdminTopicsHandlers,
  isEnabled,
} = require('@librechat/api');
const { SystemCapabilities, logger } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { requireJwtAuth } = require('~/server/middleware');
const { recordAudit } = require('~/server/services/Audit');
const { runClusteringNow } = require('~/server/services/AnalyticsTopics');
const db = require('~/models');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);
const requireReadConversations = requireCapability(SystemCapabilities.READ_CONVERSATIONS);

// Opt-in MeiliSearch backend for the analytics feed text search. Requires the
// flag plus a live, configured Meili (same gating as the index sync). When off
// or unavailable the handlers transparently use the Mongo $regex search.
const useMeiliSearch =
  (process.env.ANALYTICS_SEARCH_BACKEND || 'mongo').toLowerCase() === 'meili' &&
  isEnabled(process.env.SEARCH) &&
  Boolean(process.env.MEILI_HOST && process.env.MEILI_MASTER_KEY);

logger.info(
  `[adminAnalytics] feed search backend: ${useMeiliSearch ? 'meilisearch' : 'mongo ($regex)'}`,
);

const handlers = createAdminAnalyticsHandlers({
  listInteractions: db.listInteractions,
  listInteractionsByIds: db.listInteractionsByIds,
  searchInteractionIds: db.searchInteractionIds,
  useMeiliSearch,
  exportInteractions: db.exportInteractions,
  getConversationDetail: db.getConversationDetail,
  resolveAgentConversationIds: db.resolveAgentConversationIds,
  recordAudit,
});

// P2 — topic clustering read API + on-demand recompute. The recompute trigger is
// only wired when a topics service is configured (else POST /topics/run → 503).
const topicsHandlers = createAdminTopicsHandlers({
  getLatestAnalyticsRun: db.getLatestAnalyticsRun,
  getRunTopics: db.getRunTopics,
  getTopicAssignments: db.getTopicAssignments,
  getConversationSummaries: db.getConversationSummaries,
  runTopicClustering: process.env.TOPICS_SERVICE_URL ? runClusteringNow : undefined,
  recordAudit,
});

router.use(requireJwtAuth, requireAdminAccess);

router.get('/interactions', requireReadConversations, handlers.listInteractions);
router.get('/export', requireReadConversations, handlers.export);
router.get('/conversations/:conversationId', requireReadConversations, handlers.getConversation);

router.get('/topics', requireReadConversations, topicsHandlers.getTopics);
router.get(
  '/topics/:topicKey/conversations',
  requireReadConversations,
  topicsHandlers.getTopicConversations,
);
router.post('/topics/run', requireReadConversations, topicsHandlers.runTopics);

module.exports = router;
