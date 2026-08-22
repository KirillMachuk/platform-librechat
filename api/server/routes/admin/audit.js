const express = require('express');
const { createAdminAuditHandlers } = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');
const { getBillingWiring } = require('~/server/services/Billing');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);
const requireReadUsers = requireCapability(SystemCapabilities.READ_USERS);
const requireManageUsers = requireCapability(SystemCapabilities.MANAGE_USERS);

/**
 * Built lazily, like the billing route's: the operator allowlist comes from
 * `getBillingWiring()`, which needs the env parsed and the models registered — neither is
 * guaranteed at require time.
 *
 * 1ma's own accounting entries carry dollar limits on the external key and the
 * ledger-vs-OpenRouter comparison. The client's admin contractually sees Credits and
 * percentages only, and the «Аудит» screen renders whatever it is handed — so those
 * entries are filtered out here, for everyone who is not a billing operator.
 */
let handlers;
function getHandlers() {
  if (handlers) {
    return handlers;
  }
  const { config } = getBillingWiring();
  handlers = createAdminAuditHandlers({
    operatorEmails: config.operatorEmails,
    getAuditLogs: db.getAuditLogs,
    countAuditLogs: db.countAuditLogs,
    backfillAuditFromTransactions: db.backfillAuditFromTransactions,
    backfillAgentInvokes: db.backfillAgentInvokes,
  });
  return handlers;
}

router.use(requireJwtAuth, requireAdminAccess);

router.get('/', requireReadUsers, (req, res) => getHandlers().listAudit(req, res));
router.post('/backfill', requireManageUsers, (req, res) => getHandlers().backfillAudit(req, res));

module.exports = router;
