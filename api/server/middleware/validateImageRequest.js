const cookies = require('cookie');
const jwt = require('jsonwebtoken');
const { PermissionBits, ResourceType } = require('librechat-data-provider');
const { logger, runAsSystem, tenantStorage } = require('@librechat/data-schemas');
const { isEnabled, getBasePath } = require('@librechat/api');
const { findUser, getAgents } = require('~/models');
const { getResourcePermissionsMap } = require('~/server/services/PermissionService');
const { canManageResourceType } = require('~/server/middleware/roles/capabilities');

const OBJECT_ID_LENGTH = 24;
const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Checks VIEW access to a local agent avatar owned by another user.
 * A database reference owned by the image-directory owner is authoritative: duplicated agents
 * may legitimately share one avatar, while a caller-created pointer cannot manufacture access.
 * @param {string} userId - Authenticated user ID from the signed refresh cookie
 * @param {string} avatarPath - Local avatar path without deployment base path or query string
 * @param {string} avatarOwnerId - Owner encoded in the local image directory
 * @returns {Promise<boolean>}
 */
async function canAccessAgentAvatar(userId, avatarPath, avatarOwnerId) {
  try {
    const user = await runAsSystem(() => findUser({ _id: userId }, 'role tenantId disabled'));
    if (!user || user.disabled) {
      return false;
    }

    const checkAccess = async () => {
      const capabilityUser = {
        id: userId,
        role: user.role ?? '',
        tenantId: user.tenantId,
      };
      if (await canManageResourceType(capabilityUser, ResourceType.AGENT)) {
        return true;
      }

      const agents = await getAgents({
        author: avatarOwnerId,
        'avatar.filepath': new RegExp(`^${escapeRegex(avatarPath)}(?:\\?.*)?$`),
      });
      if (agents.length === 0) {
        return false;
      }

      const permissions = await getResourcePermissionsMap({
        userId,
        role: user.role,
        resourceType: ResourceType.AGENT,
        resourceIds: agents.map((agent) => agent._id),
      });
      return agents.some((agent) => {
        const bits = permissions.get(agent._id.toString()) ?? 0;
        return (bits & PermissionBits.VIEW) === PermissionBits.VIEW;
      });
    };

    if (user.tenantId) {
      return await tenantStorage.run({ tenantId: user.tenantId, userId }, checkAccess);
    }
    return await runAsSystem(checkAccess);
  } catch (error) {
    logger.warn(`[validateImageRequest] Agent avatar access check failed: ${error.message}`);
    return false;
  }
}

/**
 * Validates if a string is a valid MongoDB ObjectId
 * @param {string} id - String to validate
 * @returns {boolean} - Whether string is a valid ObjectId format
 */
function isValidObjectId(id) {
  if (typeof id !== 'string') {
    return false;
  }
  if (id.length !== OBJECT_ID_LENGTH) {
    return false;
  }
  return OBJECT_ID_PATTERN.test(id);
}

/**
 * Validates a LibreChat refresh token
 * @param {string} refreshToken - The refresh token to validate
 * @returns {{valid: boolean, userId?: string, error?: string}} - Validation result
 */
function validateToken(refreshToken) {
  try {
    const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    if (!isValidObjectId(payload.id)) {
      return { valid: false, error: 'Invalid User ID' };
    }

    const currentTimeInSeconds = Math.floor(Date.now() / 1000);
    if (payload.exp < currentTimeInSeconds) {
      return { valid: false, error: 'Refresh token expired' };
    }

    return { valid: true, userId: payload.id };
  } catch (err) {
    logger.warn('[validateToken]', err);
    return { valid: false, error: 'Invalid token' };
  }
}

/**
 * Factory to create the `validateImageRequest` middleware with configured secureImageLinks
 * @param {boolean} [secureImageLinks] - Whether secure image links are enabled
 */
function createValidateImageRequest(secureImageLinks) {
  if (!secureImageLinks) {
    return (_req, _res, next) => next();
  }
  /**
   * Middleware to validate image request.
   * Supports both LibreChat refresh tokens and OpenID JWT tokens.
   * Must be set by `secureImageLinks` via custom config file.
   */
  return async function validateImageRequest(req, res, next) {
    try {
      const cookieHeader = req.headers.cookie;
      if (!cookieHeader) {
        logger.warn('[validateImageRequest] No cookies provided');
        return res.status(401).send('Unauthorized');
      }

      const parsedCookies = cookies.parse(cookieHeader);
      const tokenProvider = parsedCookies.token_provider;
      let userIdForPath;

      if (tokenProvider === 'openid' && isEnabled(process.env.OPENID_REUSE_TOKENS)) {
        /** For OpenID users with OPENID_REUSE_TOKENS, use openid_user_id cookie */
        const openidUserId = parsedCookies.openid_user_id;
        if (!openidUserId) {
          logger.warn('[validateImageRequest] No OpenID user ID cookie found');
          return res.status(403).send('Access Denied');
        }

        const validationResult = validateToken(openidUserId);
        if (!validationResult.valid) {
          logger.warn(`[validateImageRequest] ${validationResult.error}`);
          return res.status(403).send('Access Denied');
        }
        userIdForPath = validationResult.userId;
      } else {
        /**
         * For non-OpenID users (or OpenID without REUSE_TOKENS), use refreshToken from cookies.
         * These users authenticate via setAuthTokens() which stores refreshToken in cookies.
         */
        const refreshToken = parsedCookies.refreshToken;

        if (!refreshToken) {
          logger.warn('[validateImageRequest] Token not provided');
          return res.status(401).send('Unauthorized');
        }

        const validationResult = validateToken(refreshToken);
        if (!validationResult.valid) {
          logger.warn(`[validateImageRequest] ${validationResult.error}`);
          return res.status(403).send('Access Denied');
        }
        userIdForPath = validationResult.userId;
      }

      if (!userIdForPath) {
        logger.warn('[validateImageRequest] No user ID available for path validation');
        return res.status(403).send('Access Denied');
      }

      const MAX_URL_LENGTH = 2048;
      if (req.originalUrl.length > MAX_URL_LENGTH) {
        logger.warn('[validateImageRequest] URL too long');
        return res.status(403).send('Access Denied');
      }

      if (req.originalUrl.includes('\x00')) {
        logger.warn('[validateImageRequest] URL contains null byte');
        return res.status(403).send('Access Denied');
      }

      let fullPath;
      try {
        fullPath = decodeURIComponent(req.originalUrl);
      } catch {
        logger.warn('[validateImageRequest] Invalid URL encoding');
        return res.status(403).send('Access Denied');
      }

      const basePath = getBasePath();
      const imagesPath = `${basePath}/images`;

      const escapedImagesPath = escapeRegex(imagesPath);
      const escapedUserId = escapeRegex(userIdForPath);
      const pathPattern = new RegExp(`^${escapedImagesPath}/${escapedUserId}/[^/]+$`);

      if (pathPattern.test(fullPath)) {
        logger.debug('[validateImageRequest] Image request validated');
        return next();
      }

      const requestPath = fullPath.split(/[?#]/, 1)[0];
      const agentAvatarPattern = new RegExp(`^${escapedImagesPath}/([a-f0-9]{24})/agent-[^/]+$`);
      const agentAvatarMatch = requestPath.match(agentAvatarPattern);
      const isAuthorizedAgentAvatar =
        agentAvatarMatch != null &&
        (await canAccessAgentAvatar(
          userIdForPath,
          requestPath.slice(basePath.length),
          agentAvatarMatch[1],
        ));

      if (isAuthorizedAgentAvatar) {
        logger.debug('[validateImageRequest] Image request validated');
        return next();
      }

      logger.warn('[validateImageRequest] Invalid image path');
      return res.status(403).send('Access Denied');
    } catch (error) {
      logger.error('[validateImageRequest] Error:', error);
      res.status(500).send('Internal Server Error');
    }
  };
}

module.exports = createValidateImageRequest;
