const express = require('express');
const { createAdminAuditHandlers } = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);
const requireReadUsers = requireCapability(SystemCapabilities.READ_USERS);
const requireManageUsers = requireCapability(SystemCapabilities.MANAGE_USERS);

const handlers = createAdminAuditHandlers({
  getAuditLogs: db.getAuditLogs,
  countAuditLogs: db.countAuditLogs,
  backfillAuditFromTransactions: db.backfillAuditFromTransactions,
});

router.use(requireJwtAuth, requireAdminAccess);

router.get('/', requireReadUsers, handlers.listAudit);
router.post('/backfill', requireManageUsers, handlers.backfillAudit);

module.exports = router;
