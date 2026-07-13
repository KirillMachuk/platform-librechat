const express = require('express');
const { createAdminBillingHandlers } = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { requireJwtAuth } = require('~/server/middleware');
const { recordAudit } = require('~/server/services/Audit');
const { getBillingWiring, getCreditIndexHealth } = require('~/server/services/Billing');

/**
 * Admin billing («Кредиты»):
 *   GET  /api/admin/billing            — summary for the «Расходы» screen (Credits/% only);
 *   POST /api/admin/billing/packages   — manual package top-up (platform operator only);
 *   POST /api/admin/billing/reconcile  — ledger vs OpenRouter check (operator only).
 * Viewing needs ACCESS_ADMIN; mutations are additionally gated inside the
 * handlers by the env operator allowlist (outside client-admin control).
 */

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);

let handlers;
function getHandlers() {
  if (handlers) {
    return handlers;
  }
  const db = require('~/models');
  const { config, openrouter, reconciler } = getBillingWiring();
  handlers = createAdminBillingHandlers({
    getCreditBillingStatus: db.getCreditBillingStatus,
    listCreditPackages: db.listCreditPackages,
    addCreditPackage: db.addCreditPackage,
    poolMicroUsd: config.poolMicroUsd,
    anchorDay: config.anchorDay,
    metering: config.enabled,
    getDegraded: () => getCreditIndexHealth().degraded,
    operatorEmails: config.operatorEmails,
    limitHeadroom: config.openrouter.headroom,
    openrouter,
    reconciler,
    recordAudit,
  });
  return handlers;
}

router.use(requireJwtAuth, requireAdminAccess);

router.get('/', (req, res) => getHandlers().getSummary(req, res));
router.post('/packages', (req, res) => getHandlers().addPackage(req, res));
router.post('/reconcile', (req, res) => getHandlers().reconcile(req, res));

module.exports = router;
