const { CacheKeys } = require('librechat-data-provider');
const { logger, DEFAULT_SESSION_EXPIRY } = require('@librechat/data-schemas');
const {
  isEnabled,
  getAdminPanelUrl,
  isAdminPanelRedirect,
  generateAdminExchangeCode,
} = require('@librechat/api');
const { syncUserEntraGroupMemberships } = require('~/server/services/PermissionService');
const { setAuthTokens, setOpenIDAuthTokens } = require('~/server/services/AuthService');
const { recordAudit, auditRequestContext } = require('~/server/services/Audit');
const getLogStores = require('~/cache/getLogStores');
const { checkBan } = require('~/server/middleware');
const { createSession, generateToken } = require('~/models');

const domains = {
  client: process.env.DOMAIN_CLIENT,
  server: process.env.DOMAIN_SERVER,
};

function createOAuthHandler(redirectUri = domains.client) {
  /**
   * A handler to process OAuth authentication results.
   * @type {Function}
   * @param {ServerRequest} req - Express request object.
   * @param {ServerResponse} res - Express response object.
   * @param {NextFunction} next - Express next middleware function.
   */
  return async (req, res, next) => {
    try {
      if (res.headersSent) {
        return;
      }

      await checkBan(req, res);
      if (req.banned) {
        return;
      }

      /**
       * Single seam for every federated sign-in — admin panel and chat app,
       * every provider — so an SSO-only deployment still has a login trail.
       * The local-password path is audited in its own controller.
       */
      recordAudit({
        actorId: req.user?._id,
        actorEmail: req.user?.email,
        actorRole: req.user?.role,
        action: 'auth.login',
        outcome: 'success',
        tenantId: req.user?.tenantId,
        metadata: {
          provider: req.user?.provider ?? 'unknown',
          adminPanel: isAdminPanelRedirect(redirectUri, getAdminPanelUrl(), domains.client),
        },
        ...auditRequestContext(req),
      });

      /** Check if this is an admin panel redirect (cross-origin or same-origin subpath) */
      if (isAdminPanelRedirect(redirectUri, getAdminPanelUrl(), domains.client)) {
        /** For admin panel, generate exchange code instead of setting cookies */
        const cache = getLogStores(CacheKeys.ADMIN_OAUTH_EXCHANGE);
        const sessionExpiry = Number(process.env.SESSION_EXPIRY) || DEFAULT_SESSION_EXPIRY;
        const token = await generateToken(req.user, sessionExpiry);

        /** Get refresh token from tokenset for OpenID users */
        const idpRefreshToken =
          req.user.provider === 'openid' && isEnabled(process.env.OPENID_REUSE_TOKENS) === true
            ? req.user.tokenset?.refresh_token || req.user.federatedTokens?.refresh_token
            : undefined;
        /**
         * Without a refresh token the panel's session simply ends at
         * SESSION_EXPIRY — 15 minutes by default — and the admin is dropped
         * back on the login page. The IdP only supplies one when token reuse is
         * enabled and the provider was asked for offline access, so a
         * LibreChat-issued one is minted otherwise; `/api/admin/oauth/refresh`
         * serves both kinds.
         */
        const refreshToken =
          idpRefreshToken ?? (await createSession(req.user._id.toString())).refreshToken;
        const expiresAt = Date.now() + sessionExpiry;

        const callbackUrl = new URL(redirectUri);
        const exchangeCode = await generateAdminExchangeCode(
          cache,
          req.user,
          token,
          refreshToken,
          callbackUrl.origin,
          req.pkceChallenge,
          expiresAt,
        );
        callbackUrl.searchParams.set('code', exchangeCode);
        logger.info(`[OAuth] Admin panel redirect with exchange code for user: ${req.user.email}`);
        return res.redirect(callbackUrl.toString());
      }

      /** Standard OAuth flow - set cookies and redirect */
      if (
        req.user &&
        req.user.provider == 'openid' &&
        isEnabled(process.env.OPENID_REUSE_TOKENS) === true
      ) {
        await syncUserEntraGroupMemberships(req.user, req.user.tokenset.access_token);
        setOpenIDAuthTokens(req.user.tokenset, req, res, {
          userId: req.user._id.toString(),
          tenantId: req.user.tenantId,
        });
      } else {
        await setAuthTokens(req.user._id, res, null, req);
      }
      res.redirect(redirectUri);
    } catch (err) {
      logger.error('Error in setting authentication tokens:', err);
      next(err);
    }
  };
}

module.exports = {
  createOAuthHandler,
};
