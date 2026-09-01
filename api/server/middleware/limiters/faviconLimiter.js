const rateLimit = require('express-rate-limit');
const { limiterCache } = require('@librechat/api');

const FAVICON_WINDOW_MS = 15 * 60 * 1000;
const FAVICON_MAX = 1200;

/**
 * Bounds how many source icons one signed-in reader can ask for, and with them how
 * many outbound requests we can be made to send.
 *
 * The ceiling is deliberately far above real reading rather than near it, because
 * every request counts — cache hits and «no icon» answers included, since the count
 * happens before the handler — and because being refused is INVISIBLE: a 429 leaves
 * the same neutral glyph as a site that has no icon, so a reader who hit the limit
 * would see nothing except worse-looking answers. At 300 two research reports of a
 * hundred sources each came within reach of it; 1200 does not.
 *
 * What it still bounds is the shape worth bounding: a loop over invented domains,
 * every one of them a cache miss and therefore an outbound request and a cache
 * entry. Those stay capped at 80 a minute per account, against a cache whose total
 * size is fixed anyway.
 *
 * Keyed by the user the cookie proves, not by address: every reader on the client's
 * network shares one. `faviconAuth` runs first and is what guarantees the key
 * exists — without it express-rate-limit puts every caller in one shared bucket
 * rather than failing, which is why the route's wiring has its own test.
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
