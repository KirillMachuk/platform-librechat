const express = require('express');
const passport = require('passport');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const openIdClient = require('openid-client');
const { CacheKeys } = require('librechat-data-provider');
const {
  logger,
  DEFAULT_SESSION_EXPIRY,
  SystemCapabilities,
  getTenantId,
} = require('@librechat/data-schemas');
const {
  isEnabled,
  getAdminPanelUrl,
  exchangeAdminCode,
  createSetBalanceConfig,
  storeAndStripChallenge,
  tenantContextMiddleware,
  preAuthTenantMiddleware,
  applyAdminRefresh,
  AdminRefreshError,
  buildOpenIDRefreshParams,
  applyLocalAdminRefresh,
} = require('@librechat/api');
const { loginController } = require('~/server/controllers/auth/LoginController');
const { hasCapability, requireCapability } = require('~/server/middleware/roles/capabilities');
const { createOAuthHandler } = require('~/server/controllers/auth/oauth');
const {
  findBalanceByUser,
  findSession,
  findUsers,
  generateToken,
  getUserById,
  upsertBalanceFields,
} = require('~/models');
const { getAppConfig } = require('~/server/services/Config');
const getLogStores = require('~/cache/getLogStores');
const { getOpenIdConfig } = require('~/strategies');
const middleware = require('~/server/middleware');

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);

const setBalanceConfig = createSetBalanceConfig({
  getAppConfig,
  findBalanceByUser,
  upsertBalanceFields,
});

const router = express.Router();

function resolveRequestOrigin(req) {
  const originHeader = req.get('origin');
  if (originHeader) {
    try {
      return new URL(originHeader).origin;
    } catch {
      return undefined;
    }
  }

  const refererHeader = req.get('referer');
  if (!refererHeader) {
    return undefined;
  }

  try {
    return new URL(refererHeader).origin;
  } catch {
    return undefined;
  }
}

/**
 * Same admin-access invariant the OAuth callback enforces. A refresh token can
 * outlive a capability change, so the bearer must not be reissued for a user
 * who no longer holds `ACCESS_ADMIN`. Fail-closed.
 * @param {Partial<IUser>} user
 * @returns {Promise<boolean>}
 */
async function canAccessAdmin(user) {
  try {
    return await hasCapability(
      {
        id: user.id ?? user._id?.toString(),
        role: user.role ?? '',
        tenantId: user.tenantId,
      },
      SystemCapabilities.ACCESS_ADMIN,
    );
  } catch (err) {
    logger.warn(`[admin/oauth/refresh] capability check failed, denying: ${err?.message}`);
    return false;
  }
}

router.post(
  '/login/local',
  middleware.logHeaders,
  middleware.loginLimiter,
  middleware.checkBan,
  middleware.requireLocalAuth,
  tenantContextMiddleware,
  requireAdminAccess,
  setBalanceConfig,
  loginController,
);

router.get('/verify', middleware.requireJwtAuth, requireAdminAccess, (req, res) => {
  const { password: _p, totpSecret: _t, __v, ...user } = req.user;
  user.id = user._id.toString();
  res.status(200).json({ user });
});

router.get('/oauth/openid/check', (req, res) => {
  const openidConfig = getOpenIdConfig();
  if (!openidConfig) {
    return res.status(404).json({
      error: 'OpenID configuration not found',
      error_code: 'OPENID_NOT_CONFIGURED',
    });
  }
  res.status(200).json({ message: 'OpenID check successful' });
});

/**
 * Generates a random hex state string for OAuth flows.
 * @returns {string} A 32-byte random hex string.
 */
function generateState() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Middleware to retrieve PKCE challenge from cache using the OAuth state.
 * Reads state from req.oauthState (set by a preceding middleware).
 * @param {string} provider - Provider name for logging.
 * @returns {Function} Express middleware.
 */
function retrievePkceChallenge(provider) {
  return async (req, res, next) => {
    if (!req.oauthState) {
      return next();
    }
    try {
      const cache = getLogStores(CacheKeys.ADMIN_OAUTH_EXCHANGE);
      const challenge = await cache.get(`pkce:${req.oauthState}`);
      if (challenge) {
        req.pkceChallenge = challenge;
        await cache.delete(`pkce:${req.oauthState}`);
      } else {
        logger.warn(
          `[admin/oauth/${provider}/callback] State present but no PKCE challenge found; PKCE will not be enforced for this request`,
        );
      }
    } catch (err) {
      logger.error(
        `[admin/oauth/${provider}/callback] Failed to retrieve PKCE challenge, aborting:`,
        err,
      );
      return res.redirect(
        `${getAdminPanelUrl()}/auth/${provider}/callback?error=pkce_retrieval_failed&error_description=Failed+to+retrieve+PKCE+challenge`,
      );
    }
    next();
  };
}

/* ──────────────────────────────────────────────
 * OpenID Admin Routes
 * ────────────────────────────────────────────── */

router.get('/oauth/openid', async (req, res, next) => {
  const state = generateState();
  const cache = getLogStores(CacheKeys.ADMIN_OAUTH_EXCHANGE);
  const stored = await storeAndStripChallenge(cache, req, state, 'openid');
  if (!stored) {
    return res.redirect(
      `${getAdminPanelUrl()}/auth/openid/callback?error=pkce_store_failed&error_description=Failed+to+store+PKCE+challenge`,
    );
  }

  return passport.authenticate('openidAdmin', {
    session: false,
    state,
  })(req, res, next);
});

router.get(
  '/oauth/openid/callback',
  (req, res, next) => {
    req.oauthState = typeof req.query.state === 'string' ? req.query.state : undefined;
    next();
  },
  passport.authenticate('openidAdmin', {
    failureRedirect: `${getAdminPanelUrl()}/auth/openid/callback?error=auth_failed&error_description=Authentication+failed`,
    failureMessage: true,
    session: false,
  }),
  tenantContextMiddleware,
  retrievePkceChallenge('openid'),
  requireAdminAccess,
  setBalanceConfig,
  middleware.checkDomainAllowed,
  createOAuthHandler(`${getAdminPanelUrl()}/auth/openid/callback`),
);

/* ──────────────────────────────────────────────
 * SAML Admin Routes
 * ────────────────────────────────────────────── */

router.get('/oauth/saml', async (req, res, next) => {
  const state = generateState();
  const cache = getLogStores(CacheKeys.ADMIN_OAUTH_EXCHANGE);
  const stored = await storeAndStripChallenge(cache, req, state, 'saml');
  if (!stored) {
    return res.redirect(
      `${getAdminPanelUrl()}/auth/saml/callback?error=pkce_store_failed&error_description=Failed+to+store+PKCE+challenge`,
    );
  }

  return passport.authenticate('samlAdmin', {
    session: false,
    additionalParams: { RelayState: state },
  })(req, res, next);
});

router.post(
  '/oauth/saml/callback',
  (req, res, next) => {
    req.oauthState = typeof req.body.RelayState === 'string' ? req.body.RelayState : undefined;
    next();
  },
  passport.authenticate('samlAdmin', {
    failureRedirect: `${getAdminPanelUrl()}/auth/saml/callback?error=auth_failed&error_description=Authentication+failed`,
    failureMessage: true,
    session: false,
  }),
  tenantContextMiddleware,
  retrievePkceChallenge('saml'),
  requireAdminAccess,
  setBalanceConfig,
  middleware.checkDomainAllowed,
  createOAuthHandler(`${getAdminPanelUrl()}/auth/saml/callback`),
);

/* ──────────────────────────────────────────────
 * Google Admin Routes
 * ────────────────────────────────────────────── */

router.get('/oauth/google', async (req, res, next) => {
  const state = generateState();
  const cache = getLogStores(CacheKeys.ADMIN_OAUTH_EXCHANGE);
  const stored = await storeAndStripChallenge(cache, req, state, 'google');
  if (!stored) {
    return res.redirect(
      `${getAdminPanelUrl()}/auth/google/callback?error=pkce_store_failed&error_description=Failed+to+store+PKCE+challenge`,
    );
  }

  return passport.authenticate('googleAdmin', {
    scope: ['openid', 'profile', 'email'],
    session: false,
    state,
  })(req, res, next);
});

router.get(
  '/oauth/google/callback',
  (req, res, next) => {
    req.oauthState = typeof req.query.state === 'string' ? req.query.state : undefined;
    next();
  },
  passport.authenticate('googleAdmin', {
    failureRedirect: `${getAdminPanelUrl()}/auth/google/callback?error=auth_failed&error_description=Authentication+failed`,
    failureMessage: true,
    session: false,
  }),
  tenantContextMiddleware,
  retrievePkceChallenge('google'),
  requireAdminAccess,
  setBalanceConfig,
  middleware.checkDomainAllowed,
  createOAuthHandler(`${getAdminPanelUrl()}/auth/google/callback`),
);

/* ──────────────────────────────────────────────
 * GitHub Admin Routes
 * ────────────────────────────────────────────── */

router.get('/oauth/github', async (req, res, next) => {
  const state = generateState();
  const cache = getLogStores(CacheKeys.ADMIN_OAUTH_EXCHANGE);
  const stored = await storeAndStripChallenge(cache, req, state, 'github');
  if (!stored) {
    return res.redirect(
      `${getAdminPanelUrl()}/auth/github/callback?error=pkce_store_failed&error_description=Failed+to+store+PKCE+challenge`,
    );
  }

  return passport.authenticate('githubAdmin', {
    scope: ['user:email', 'read:user'],
    session: false,
    state,
  })(req, res, next);
});

router.get(
  '/oauth/github/callback',
  (req, res, next) => {
    req.oauthState = typeof req.query.state === 'string' ? req.query.state : undefined;
    next();
  },
  passport.authenticate('githubAdmin', {
    failureRedirect: `${getAdminPanelUrl()}/auth/github/callback?error=auth_failed&error_description=Authentication+failed`,
    failureMessage: true,
    session: false,
  }),
  tenantContextMiddleware,
  retrievePkceChallenge('github'),
  requireAdminAccess,
  setBalanceConfig,
  middleware.checkDomainAllowed,
  createOAuthHandler(`${getAdminPanelUrl()}/auth/github/callback`),
);

/* ──────────────────────────────────────────────
 * Discord Admin Routes
 * ────────────────────────────────────────────── */

router.get('/oauth/discord', async (req, res, next) => {
  const state = generateState();
  const cache = getLogStores(CacheKeys.ADMIN_OAUTH_EXCHANGE);
  const stored = await storeAndStripChallenge(cache, req, state, 'discord');
  if (!stored) {
    return res.redirect(
      `${getAdminPanelUrl()}/auth/discord/callback?error=pkce_store_failed&error_description=Failed+to+store+PKCE+challenge`,
    );
  }

  return passport.authenticate('discordAdmin', {
    scope: ['identify', 'email'],
    session: false,
    state,
  })(req, res, next);
});

router.get(
  '/oauth/discord/callback',
  (req, res, next) => {
    req.oauthState = typeof req.query.state === 'string' ? req.query.state : undefined;
    next();
  },
  passport.authenticate('discordAdmin', {
    failureRedirect: `${getAdminPanelUrl()}/auth/discord/callback?error=auth_failed&error_description=Authentication+failed`,
    failureMessage: true,
    session: false,
  }),
  tenantContextMiddleware,
  retrievePkceChallenge('discord'),
  requireAdminAccess,
  setBalanceConfig,
  middleware.checkDomainAllowed,
  createOAuthHandler(`${getAdminPanelUrl()}/auth/discord/callback`),
);

/* ──────────────────────────────────────────────
 * Facebook Admin Routes
 * ────────────────────────────────────────────── */

router.get('/oauth/facebook', async (req, res, next) => {
  const state = generateState();
  const cache = getLogStores(CacheKeys.ADMIN_OAUTH_EXCHANGE);
  const stored = await storeAndStripChallenge(cache, req, state, 'facebook');
  if (!stored) {
    return res.redirect(
      `${getAdminPanelUrl()}/auth/facebook/callback?error=pkce_store_failed&error_description=Failed+to+store+PKCE+challenge`,
    );
  }

  return passport.authenticate('facebookAdmin', {
    scope: ['public_profile'],
    session: false,
    state,
  })(req, res, next);
});

router.get(
  '/oauth/facebook/callback',
  (req, res, next) => {
    req.oauthState = typeof req.query.state === 'string' ? req.query.state : undefined;
    next();
  },
  passport.authenticate('facebookAdmin', {
    failureRedirect: `${getAdminPanelUrl()}/auth/facebook/callback?error=auth_failed&error_description=Authentication+failed`,
    failureMessage: true,
    session: false,
  }),
  tenantContextMiddleware,
  retrievePkceChallenge('facebook'),
  requireAdminAccess,
  setBalanceConfig,
  middleware.checkDomainAllowed,
  createOAuthHandler(`${getAdminPanelUrl()}/auth/facebook/callback`),
);

/* ──────────────────────────────────────────────
 * Apple Admin Routes (POST callback)
 * ────────────────────────────────────────────── */

router.get('/oauth/apple', async (req, res, next) => {
  const state = generateState();
  const cache = getLogStores(CacheKeys.ADMIN_OAUTH_EXCHANGE);
  const stored = await storeAndStripChallenge(cache, req, state, 'apple');
  if (!stored) {
    return res.redirect(
      `${getAdminPanelUrl()}/auth/apple/callback?error=pkce_store_failed&error_description=Failed+to+store+PKCE+challenge`,
    );
  }

  return passport.authenticate('appleAdmin', {
    session: false,
    state,
  })(req, res, next);
});

router.post(
  '/oauth/apple/callback',
  (req, res, next) => {
    req.oauthState = typeof req.body.state === 'string' ? req.body.state : undefined;
    next();
  },
  passport.authenticate('appleAdmin', {
    failureRedirect: `${getAdminPanelUrl()}/auth/apple/callback?error=auth_failed&error_description=Authentication+failed`,
    failureMessage: true,
    session: false,
  }),
  tenantContextMiddleware,
  retrievePkceChallenge('apple'),
  requireAdminAccess,
  setBalanceConfig,
  middleware.checkDomainAllowed,
  createOAuthHandler(`${getAdminPanelUrl()}/auth/apple/callback`),
);

/** Regex pattern for valid exchange codes: 64 hex characters */
const EXCHANGE_CODE_PATTERN = /^[a-f0-9]{64}$/;

/**
 * Exchange OAuth authorization code for tokens.
 * This endpoint is called server-to-server by the admin panel.
 * The code is one-time-use and expires in 30 seconds.
 *
 * POST /api/admin/oauth/exchange
 * Body: { code: string, code_verifier?: string }
 * Response: { token: string, refreshToken: string, user: object }
 */
router.post('/oauth/exchange', middleware.loginLimiter, async (req, res) => {
  try {
    const { code, code_verifier: codeVerifier } = req.body;

    if (!code) {
      logger.warn('[admin/oauth/exchange] Missing authorization code');
      return res.status(400).json({
        error: 'Missing authorization code',
        error_code: 'MISSING_CODE',
      });
    }

    if (typeof code !== 'string' || !EXCHANGE_CODE_PATTERN.test(code)) {
      logger.warn('[admin/oauth/exchange] Invalid authorization code format');
      return res.status(400).json({
        error: 'Invalid authorization code format',
        error_code: 'INVALID_CODE_FORMAT',
      });
    }

    if (
      codeVerifier !== undefined &&
      (typeof codeVerifier !== 'string' || codeVerifier.length < 1 || codeVerifier.length > 512)
    ) {
      logger.warn('[admin/oauth/exchange] Invalid code_verifier format');
      return res.status(400).json({
        error: 'Invalid code_verifier',
        error_code: 'INVALID_VERIFIER',
      });
    }

    const cache = getLogStores(CacheKeys.ADMIN_OAUTH_EXCHANGE);
    const requestOrigin = resolveRequestOrigin(req);
    const result = await exchangeAdminCode(cache, code, requestOrigin, codeVerifier);

    if (!result) {
      return res.status(401).json({
        error: 'Invalid or expired authorization code',
        error_code: 'INVALID_OR_EXPIRED_CODE',
      });
    }

    res.json(result);
  } catch (error) {
    logger.error('[admin/oauth/exchange] Error:', error);
    res.status(500).json({
      error: 'Internal server error',
      error_code: 'INTERNAL_ERROR',
    });
  }
});

/**
 * Admin-panel-shaped token refresh, for both kinds of admin session.
 *
 * The standard `/api/auth/refresh` controller reads the refresh token from
 * cookies, which a cross-origin admin panel can't set. This endpoint accepts
 * the refresh token in the request body, mints a fresh LibreChat JWT, and
 * returns the same response shape as `/api/admin/oauth/exchange`.
 *
 * Two token kinds are served by one endpoint, so the panel needs no knowledge
 * of how its session was opened:
 *   - a LibreChat-issued refresh token (local-password admins: the owner's
 *     superadmin and the break-glass account) is verified and resolved here,
 *     without involving the IdP;
 *   - anything else is treated as an IdP refresh token and exchanged at the
 *     issuer, which additionally re-checks upstream revocation.
 *
 * POST /api/admin/oauth/refresh
 * Body:     { refresh_token: string, user_id?: string }
 *           (`refreshToken` is accepted as an alias for `refresh_token`)
 * Response: { token: string, refreshToken?: string, user: object, expiresAt: number }
 *
 * Errors (all responses are `{ error: string, error_code: string }`):
 *   400 MISSING_REFRESH_TOKEN  — refresh token absent or empty
 *   401 INVALID_REFRESH_TOKEN  — LibreChat refresh token carries no user reference
 *   401 SESSION_NOT_FOUND      — no live session matches the LibreChat refresh token
 *   401 REFRESH_FAILED         — IdP rejected the refresh grant
 *   401 USER_NOT_FOUND         — no LibreChat user matches the refreshed identity
 *   401 USER_ID_MISMATCH       — supplied user_id resolves to a user with a different openidId
 *   401 ISSUER_MISMATCH        — refreshed tokenset was issued by an unexpected issuer
 *   401 TENANT_MISMATCH        — resolved user belongs to a different tenant than the request
 *   403 FORBIDDEN              — resolved user no longer holds ACCESS_ADMIN
 *   403 TOKEN_REUSE_DISABLED   — IdP path only: OPENID_REUSE_TOKENS is not enabled
 *   502 IDP_INCOMPLETE         — IdP returned a tokenset missing access_token
 *   502 CLAIMS_INCOMPLETE      — IdP tokenset has no readable claims or no sub
 *   503 OPENID_NOT_CONFIGURED  — IdP path only: OpenID is not configured on this server
 *   500 INTERNAL_ERROR         — anything else (logged server-side)
 */
router.post(
  '/oauth/refresh',
  middleware.loginLimiter,
  preAuthTenantMiddleware,
  async (req, res) => {
    try {
      const {
        refresh_token: snakeCaseToken,
        refreshToken: camelCaseToken,
        user_id: userId,
      } = req.body ?? {};
      /** Both spellings are accepted: the admin panel historically sent `refreshToken`. */
      const refreshToken =
        typeof snakeCaseToken === 'string' && snakeCaseToken.length > 0
          ? snakeCaseToken
          : camelCaseToken;
      if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
        return res.status(400).json({
          error: 'Missing refresh_token',
          error_code: 'MISSING_REFRESH_TOKEN',
        });
      }

      const sessionExpiryMs = Number(process.env.SESSION_EXPIRY) || DEFAULT_SESSION_EXPIRY;
      const mintToken = async (user) => ({
        token: await generateToken(user, sessionExpiryMs),
        expiresAt: Date.now() + sessionExpiryMs,
      });

      /**
       * Local-password admin sessions resolve here and never reach the IdP
       * branch below; `applyLocalAdminRefresh` returns null for tokens this
       * server did not sign, which is the signal to fall through.
       */
      const localRefresh = await applyLocalAdminRefresh(
        refreshToken,
        {
          verifyRefreshToken: async (token) => {
            try {
              return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
            } catch {
              return null;
            }
          },
          findSession: (params) => findSession(params),
          getUserById,
          canAccessAdmin,
          mintToken,
        },
        { tenantId: getTenantId() },
      );
      if (localRefresh) {
        return res.json(localRefresh);
      }

      if (!isEnabled(process.env.OPENID_REUSE_TOKENS)) {
        return res.status(403).json({
          error: 'OpenID token reuse is not enabled',
          error_code: 'TOKEN_REUSE_DISABLED',
        });
      }

      let openIdConfig;
      try {
        openIdConfig = getOpenIdConfig();
      } catch {
        return res.status(503).json({
          error: 'OpenID is not configured',
          error_code: 'OPENID_NOT_CONFIGURED',
        });
      }

      const refreshParams = buildOpenIDRefreshParams();
      logger.debug('[admin/oauth/refresh] OpenID refresh params', {
        has_scope: Boolean(process.env.OPENID_SCOPE),
        has_refresh_audience: Boolean(process.env.OPENID_REFRESH_AUDIENCE),
      });
      let tokenset;
      try {
        tokenset = await openIdClient.refreshTokenGrant(openIdConfig, refreshToken, refreshParams);
        logger.debug('[admin/oauth/refresh] OpenID refresh succeeded', {
          has_access_token: Boolean(tokenset.access_token),
          has_id_token: Boolean(tokenset.id_token),
          has_refresh_token: Boolean(tokenset.refresh_token),
          expires_in: tokenset.expires_in,
        });
      } catch (err) {
        logger.warn('[admin/oauth/refresh] IdP refresh grant failed', {
          code: err?.code,
          name: err?.name,
        });
        return res.status(401).json({
          error: 'Refresh failed',
          error_code: 'REFRESH_FAILED',
        });
      }

      const expectedIssuer = openIdConfig.serverMetadata?.()?.issuer;

      const result = await applyAdminRefresh(
        tokenset,
        {
          findUsers,
          getUserById,
          canAccessAdmin,
          mintToken,
        },
        {
          userId: typeof userId === 'string' && userId.length > 0 ? userId : undefined,
          previousRefreshToken: refreshToken,
          expectedIssuer,
          tenantId: getTenantId(),
        },
      );
      return res.json(result);
    } catch (error) {
      /** Both refresh paths signal expected failures with AdminRefreshError. */
      if (error instanceof AdminRefreshError) {
        return res.status(error.status).json({ error: error.message, error_code: error.code });
      }
      logger.error('[admin/oauth/refresh] Error:', error);
      res.status(500).json({
        error: 'Internal server error',
        error_code: 'INTERNAL_ERROR',
      });
    }
  },
);

module.exports = router;
