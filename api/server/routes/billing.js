const crypto = require('node:crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { createBillingIngestHandlers, limiterCache } = require('@librechat/api');
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
 * Defence-in-depth backstop for these token-guarded, service-to-service endpoints.
 * A single GLOBAL ceiling (all callers share one bucket — these endpoints have exactly
 * one legitimate caller, the anonymizer on the internal network) sits far above any real
 * volume — one contour reports a handful of spends per second at most — so it never
 * throttles real billing traffic, only a token-brute-force / DoS loop (orders of
 * magnitude faster). Keyed by a constant, not by IP, so there is no per-IP / IPv6-subnet
 * concern to reason about (express-rate-limit's ipKeyGenerator caveat does not apply).
 */
const ingestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 12_000, // ~200 req/s total — pure abuse backstop, not a functional limit
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: () => 'billing-ingest',
  handler: (_req, res) => res.status(429).json({ error: 'too many billing requests' }),
  store: limiterCache('billing_ingest_limiter'),
});

router.use(ingestLimiter);

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
