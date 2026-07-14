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
 * Post-auth backstop against a *runaway legitimate caller* (a buggy anonymizer looping
 * on /spend). Placed AFTER the token check below, so an unauthenticated flood is rejected
 * with a cheap constant-time 401 without ever incrementing this bucket — that ordering is
 * what prevents a public flood from starving the one real caller. Because only the
 * token-holding anonymizer reaches here, a single global-keyed ceiling is correct (there
 * is exactly one caller) and sidesteps any per-IP / IPv6 keying concern. 12000/min sits
 * far above any real volume — one contour reports a handful of spends per second at most.
 */
const ingestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 12_000, // ~200 req/s — pure abuse backstop, not a functional limit
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: () => 'billing-ingest',
  handler: (_req, res) => res.status(429).json({ error: 'too many billing requests' }),
  store: limiterCache('billing_ingest_limiter'),
});

// Authenticate FIRST — see the limiter note above: rejecting unauthenticated traffic here,
// before the rate limiter, is what stops a public flood from exhausting the shared bucket.
router.use((req, res, next) => {
  const { config } = getBillingWiring();
  if (!config.enabled) {
    return res.status(503).json({ error: 'billing is disabled' });
  }
  const token = req.headers['x-billing-token'];
  if (typeof token !== 'string' || !token || !tokenEqual(token, config.internalToken)) {
    return res.status(401).json({ error: 'invalid billing token' });
  }
  return next();
});

router.use(ingestLimiter);

router.post('/spend', (req, res) => getHandlers().postSpend(req, res));
router.get('/status', (req, res) => getHandlers().getStatus(req, res));

module.exports = router;
