/**
 * The skills routes must not build their upload rate limiters while this module is being
 * imported.
 *
 * `api/server/index.js` requires `./routes` (and through it this module) at load time, then calls
 * `performStartupChecks` — which is what copies librechat.yaml's `rateLimits` into the
 * environment. A limiter built at import therefore freezes at the library defaults and ignores
 * the deployment's configuration. That matters here beyond this route: skills and `/api/files`
 * share one counter (same store prefix, same user key), so a stand configured for 400 uploads an
 * hour had skills still refusing at 50 — a library import locked skill uploads out for the rest
 * of the window, and `/api/files/config` advertised a ceiling this route did not honour.
 *
 * Deliberately asserts the timing rather than the resulting number: the number is a deployment
 * setting, and reading the environment too early is the defect itself.
 */

jest.mock('~/server/middleware/limiters/uploadLimiters', () => ({
  createFileLimiters: jest.fn(() => ({
    fileUploadIpLimiter: (req, res, next) => next(),
    fileUploadUserLimiter: (req, res, next) => next(),
  })),
}));

jest.mock('~/server/services/Config', () => ({
  getAppConfig: jest.fn().mockResolvedValue({}),
  getCustomConfig: jest.fn().mockResolvedValue({}),
  setCachedTools: jest.fn(),
  getCachedTools: jest.fn(),
}));
jest.mock('~/server/middleware/config/app', () => (req, _res, next) => next());
jest.mock('~/server/middleware', () => ({
  requireJwtAuth: (req, res, next) => next(),
  canAccessSkillResource: () => (req, res, next) => next(),
}));
jest.mock('~/server/services/Skills/sync', () => ({ syncSkillsFromDisk: jest.fn() }));

const { createFileLimiters } = require('~/server/middleware/limiters/uploadLimiters');

describe('skills routes — upload limiters', () => {
  it('does not build them at import time', () => {
    require('~/server/routes/skills');

    expect(createFileLimiters).not.toHaveBeenCalled();
  });
});
