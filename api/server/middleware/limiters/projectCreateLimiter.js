const rateLimit = require('express-rate-limit');
const { limiterCache } = require('@librechat/api');

const PROJECT_CREATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const PROJECT_CREATE_MAX = 60; // 60 new projects per user per hour

/**
 * Caps how fast one user can create projects. Bulk project creation inflates the
 * per-user list aggregation (getProjects) and its file/conversation counts, so a
 * runaway loop is a self-DoS vector. PATCH/DELETE are intentionally uncapped —
 * they don't add aggregation load — so active editing is never throttled.
 */
const projectCreateLimiter = rateLimit({
  windowMs: PROJECT_CREATE_WINDOW_MS,
  max: PROJECT_CREATE_MAX,
  handler: (_req, res) => {
    res.status(429).json({ error: 'Too many projects created. Try again later.' });
  },
  keyGenerator: (req) => req.user?.id,
  store: limiterCache('project_create_limiter'),
});

module.exports = { projectCreateLimiter };
