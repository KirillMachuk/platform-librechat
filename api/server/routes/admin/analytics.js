const express = require('express');
const { createAdminAnalyticsHandlers } = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { requireJwtAuth } = require('~/server/middleware');
const { recordAudit } = require('~/server/services/Audit');
const db = require('~/models');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);
const requireReadConversations = requireCapability(SystemCapabilities.READ_CONVERSATIONS);

const handlers = createAdminAnalyticsHandlers({
  listInteractions: db.listInteractions,
  getConversationDetail: db.getConversationDetail,
  resolveAgentConversationIds: db.resolveAgentConversationIds,
  recordAudit,
});

router.use(requireJwtAuth, requireAdminAccess);

router.get('/interactions', requireReadConversations, handlers.listInteractions);
router.get('/conversations/:conversationId', requireReadConversations, handlers.getConversation);

module.exports = router;
