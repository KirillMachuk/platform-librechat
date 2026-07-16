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
    getCreditGateStatus: db.getCreditGateStatus,
    poolMicroUsd: config.poolMicroUsd,
    anchorDay: config.anchorDay,
    onSpendRecorded: (result) => {
      notifier.handleSpendResult(result).catch((err) => {
        logger.error('[billing] notifier failed:', err);
      });
    },
  });
  return handlers;
}

/**
 * NO rate limiter here — deliberately.
 *
 * A Redis-backed limiter (`limiterCache` → rate-limit-redis) executes a Lua script via
 * EVALSHA on every request. When Redis restarts its script cache is empty, the store
 * throws `NOSCRIPT`, and the request 500s — which on THIS route means the anonymizer's
 * spend report is rejected and real money silently stops being counted. That is exactly
 * the failure this whole subsystem exists to prevent, traded for a backstop against a
 * threat the shared secret already closes (a 64-char random token is not brute-forceable,
 * and volumetric floods belong at Railway's edge, not in the money path).
 *
 * The token check below is the gate, and it depends on nothing but memory: unauthenticated
 * traffic is rejected by a constant-time compare with no I/O at all.
 */
router.use((req, res, next) => {
  const { config } = getBillingWiring();
  if (!config.enabled) {
    return res.status(503).json({ error: 'billing is disabled' });
  }
  const token = req.headers['x-billing-token'];
  if (typeof token !== 'string' || !token || !tokenEqual(token, config.internalToken)) {
    /* Audit trail for the money path: a token mismatch between the anonymizer
     * (BILLING_TOKEN) and this service (BILLING_INTERNAL_TOKEN) silently zeroes the
     * ledger — the anonymizer drops rejected reports without retry, and its own logs
     * are not always visible. This line makes the failure diagnosable from one side. */
    logger.warn(
      `[billing] rejected ${req.method} ${req.path}: invalid x-billing-token (ip=${req.ip}, tokenPresent=${Boolean(token)})`,
    );
    return res.status(401).json({ error: 'invalid billing token' });
  }
  return next();
});

router.post('/spend', (req, res) => getHandlers().postSpend(req, res));
router.get('/status', (req, res) => getHandlers().getStatus(req, res));

module.exports = router;
