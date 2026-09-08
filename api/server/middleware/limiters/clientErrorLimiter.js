const rateLimit = require('express-rate-limit');
const { limiterCache, removePorts } = require('@librechat/api');

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const windowMs = positiveInt(process.env.CLIENT_ERROR_WINDOW, 10) * 60 * 1000;
const max = positiveInt(process.env.CLIENT_ERROR_MAX, 20);
/* The per-IP ceiling is only as good as the IP, and behind a proxy the IP comes from
 * a header the caller can write. So a second, shared bucket bounds what the endpoint
 * can cost in total: past this many reports in a window the contour stops writing,
 * whoever is asking. Winston rotates the error log at 20 MB but keeps every rolled
 * file for 14 days, so "unbounded writes" means "unbounded disk". */
/* 60 per window is ~8 600 reports a day, orders of magnitude above what a contour
 * with a handful of users produces, and low enough that filling the disk through this
 * endpoint stops being possible. The previous 600 was a number, not a bound. */
const globalMax = positiveInt(process.env.CLIENT_ERROR_GLOBAL_MAX, 60);

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

const clientErrorGlobalLimiter = rateLimit({
  windowMs,
  max: globalMax,
  handler,
  keyGenerator: () => 'all',
  store: limiterCache('client_error_global_limiter'),
});

module.exports = { clientErrorLimiter, clientErrorGlobalLimiter };
