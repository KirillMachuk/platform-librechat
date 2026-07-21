const { logger, ResourceCapabilityMap } = require('@librechat/data-schemas');
const { generateCapabilityCheck, capabilityContextMiddleware } = require('@librechat/api');
const { getUserPrincipals, hasCapabilityForPrincipals } = require('~/models');

const { hasCapability, requireCapability, hasConfigCapability } = generateCapabilityCheck({
  getUserPrincipals,
  hasCapabilityForPrincipals,
});

/**
 * Whether the user holds the management capability for an ACL resource type,
 * which grants unrestricted access to every resource of that type. Fails closed:
 * a lookup error denies the bypass rather than escalating it.
 * @param {{ id: string, role: string, tenantId?: string }} user
 * @param {string} resourceType - An ACL `ResourceType` value
 * @returns {Promise<boolean>}
 */
const canManageResourceType = async (user, resourceType) => {
  const capability = ResourceCapabilityMap[resourceType];
  if (capability == null) {
    return false;
  }
  try {
    return await hasCapability(user, capability);
  } catch (error) {
    logger.warn(
      `[canManageResourceType] capability check failed for ${resourceType}, denying: ${error.message}`,
    );
    return false;
  }
};

module.exports = {
  hasCapability,
  requireCapability,
  hasConfigCapability,
  canManageResourceType,
  capabilityContextMiddleware,
};
