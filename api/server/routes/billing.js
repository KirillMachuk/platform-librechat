const crypto = require('node:crypto');
const express = require('express');
const { createBillingIngestHandlers } = require('@librechat/api');
const { logger } = require('@librechat/data-schemas');
const { getBillingWiring } = require('~/server/services/Billing');

/**
 * Internal billing API for the anonymizer (service-to-service, NOT user-facing):
 *   POST /api/billing/spend  — report one response's actual OpenRouter cost;
 *   GET  /api/billing/status — soft-block gate (anonymizer caches briefly).
 * Auth: shared secret `x-billing-token` (BILLING_INTERNAL_TOKEN on both sides),
 * constant-time compare. Everything is built lazily — route modules load before
 * dotenv/mongoose are ready.
 */

const router = express.Router();

function tokenEqual(provided, expected) {
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

let handlers;
function getHandlers() {
  if (handlers) {
    return handlers;
  }
  const db = require('~/models');
  const { config, notifier } = getBillingWiring();
  handlers = createBillingIngestHandlers({
    recordCreditSpend: db.recordCreditSpend,
    getCreditBillingStatus: db.getCreditBillingStatus,
    poolMicroUsd: config.poolMicroUsd,
    onSpendRecorded: (result) => {
      notifier.handleSpendResult(result).catch((err) => {
        logger.error('[billing] notifier failed:', err);
      });
    },
  });
  return handlers;
}

router.use((req, res, next) => {
  const { config } = getBillingWiring();
  if (!config.enabled) {
    return res.status(503).json({ error: 'billing is disabled (BILLING_INTERNAL_TOKEN not set)' });
  }
  const token = req.headers['x-billing-token'];
  if (typeof token !== 'string' || !token || !tokenEqual(token, config.internalToken)) {
    return res.status(401).json({ error: 'invalid billing token' });
  }
  return next();
});

router.post('/spend', (req, res) => getHandlers().postSpend(req, res));
router.get('/status', (req, res) => getHandlers().getStatus(req, res));

module.exports = router;
