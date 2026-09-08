const rateLimit = require('express-rate-limit');
const { limiterCache, removePorts } = require('@librechat/api');

const { CLIENT_ERROR_WINDOW = 10, CLIENT_ERROR_MAX = 20 } = process.env;
const windowMs = CLIENT_ERROR_WINDOW * 60 * 1000;
const max = CLIENT_ERROR_MAX;

/**
 * Silently drops the excess instead of answering 429.
 *
 * The caller is a crashed browser, not a person: a render loop can fire the same
 * failure hundreds of times a second, and telling it "too many requests" invites a
 * retry while teaching the user nothing. The report is best-effort by definition —
 * the client already forgets the response — so the honest reply is "accepted, and
 * quietly binned", which keeps a broken tab from filling the contour's error log.
 *
 * No `logViolation` either: hitting this limit means the page is broken, not that
 * someone is attacking, and scoring it as abuse would ban users for our own bugs.
 */
const handler = (_req, res) => res.status(202).json({ ok: true });

const clientErrorLimiter = rateLimit({
  windowMs,
  max,
  handler,
  keyGenerator: removePorts,
  store: limiterCache('client_error_limiter'),
});

module.exports = clientErrorLimiter;
