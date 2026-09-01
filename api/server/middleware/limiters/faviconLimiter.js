const rateLimit = require('express-rate-limit');
const { limiterCache } = require('@librechat/api');

const FAVICON_WINDOW_MS = 15 * 60 * 1000;
const FAVICON_MAX = 300;

/**
 * Bounds how many source icons one signed-in reader can ask for, and with them how
 * many outbound requests we can be made to send.
 *
 * A cached domain costs nothing outbound and the cache holds for a week, so real
 * reading barely touches this: the heaviest single answer any research produces
 * carries well under a hundred sources, and reading it again is free. The ceiling
 * is here for the other shape — a loop over invented domains, every one of them a
 * cache miss and therefore an outbound request and a cache entry.
 *
 * Keyed by the user the cookie proves, not by address: every reader on the client's
 * network shares one.
 */
const faviconLimiter = rateLimit({
  windowMs: FAVICON_WINDOW_MS,
  max: FAVICON_MAX,
  handler: (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.status(429).end();
  },
  keyGenerator: (_req, res) => res.locals.userId,
  store: limiterCache('favicon_limiter'),
});

module.exports = { faviconLimiter };
