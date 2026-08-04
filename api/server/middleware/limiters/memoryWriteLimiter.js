const rateLimit = require('express-rate-limit');
const { limiterCache } = require('@librechat/api');

const MEMORY_WRITE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MEMORY_WRITE_MAX = 120; // 120 hand-written memory saves per user per hour

/**
 * Caps how fast one user can save memories by hand. Every save is screened for
 * personal data, and that screening runs a NER model inside the same admission lane
 * the chat uses — so a loop against this route is not merely wasteful, it competes
 * with everyone's conversations. Reads and deletes are intentionally uncapped: they
 * never reach the screening service.
 *
 * The ceiling is far above deliberate editing (a profile is a handful of entries)
 * and far below what it takes to saturate the lane.
 */
const memoryWriteLimiter = rateLimit({
  windowMs: MEMORY_WRITE_WINDOW_MS,
  max: MEMORY_WRITE_MAX,
  handler: (_req, res) => {
    res.status(429).json({ error: 'Too many memory updates. Try again later.' });
  },
  keyGenerator: (req) => req.user?.id,
  store: limiterCache('memory_write_limiter'),
});

module.exports = { memoryWriteLimiter };
