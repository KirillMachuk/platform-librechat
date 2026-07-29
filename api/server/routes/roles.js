const express = require('express');
const { logger, SystemCapabilities } = require('@librechat/data-schemas');
const {
  SystemRoles,
  roleDefaults,
  PermissionTypes,
  agentPermissionsSchema,
  promptPermissionsSchema,
  memoryPermissionsSchema,
  mcpServersPermissionsSchema,
  marketplacePermissionsSchema,
  peoplePickerPermissionsSchema,
  remoteAgentsPermissionsSchema,
  skillPermissionsSchema,
} = require('librechat-data-provider');
const { hasCapability, requireCapability } = require('~/server/middleware/roles/capabilities');
const { auditRolePermissionUpdate } = require('~/server/middleware/auditRoleManagement');
const { updateRoleByName, getRoleByName } = require('~/models');
const { requireJwtAuth } = require('~/server/middleware');

const router = express.Router();
router.use(requireJwtAuth);
const manageRoles = requireCapability(SystemCapabilities.MANAGE_ROLES);

/**
 * Permission configuration mapping
 * Maps route paths to their corresponding schemas and permission types
 */
const permissionConfigs = {
  prompts: {
    schema: promptPermissionsSchema,
    permissionType: PermissionTypes.PROMPTS,
    errorMessage: 'Invalid prompt permissions.',
  },
  agents: {
    schema: agentPermissionsSchema,
    permissionType: PermissionTypes.AGENTS,
    errorMessage: 'Invalid agent permissions.',
  },
  memories: {
    schema: memoryPermissionsSchema,
    permissionType: PermissionTypes.MEMORIES,
    errorMessage: 'Invalid memory permissions.',
  },
  'people-picker': {
    schema: peoplePickerPermissionsSchema,
    permissionType: PermissionTypes.PEOPLE_PICKER,
    errorMessage: 'Invalid people picker permissions.',
  },
  'mcp-servers': {
    schema: mcpServersPermissionsSchema,
    permissionType: PermissionTypes.MCP_SERVERS,
    errorMessage: 'Invalid MCP servers permissions.',
  },
  marketplace: {
    schema: marketplacePermissionsSchema,
    permissionType: PermissionTypes.MARKETPLACE,
    errorMessage: 'Invalid marketplace permissions.',
  },
  'remote-agents': {
    schema: remoteAgentsPermissionsSchema,
    permissionType: PermissionTypes.REMOTE_AGENTS,
    errorMessage: 'Invalid remote agents permissions.',
  },
  skills: {
    schema: skillPermissionsSchema,
    permissionType: PermissionTypes.SKILLS,
    errorMessage: 'Invalid skill permissions.',
  },
};

/**
 * Generic handler for updating permissions
 * @param {string} permissionKey - The key from permissionConfigs
 * @returns {Function} Express route handler
 */
const createPermissionUpdateHandler = (permissionKey) => {
  const config = permissionConfigs[permissionKey];

  return async (req, res) => {
    const { roleName } = req.params;
    const updates = req.body;

    try {
      const parsedUpdates = config.schema.partial().parse(updates);
      /**
       * What the audit hook records has to be what was applied, not what was
       * asked for: the schema drops unknown keys, so a body naming a permission
       * that does not exist would otherwise appear in the trail as a change that
       * never happened. The hook reads this on settle, after the handler ran.
       */
      req.auditAppliedPermissions = parsedUpdates;

      const role = await getRoleByName(roleName);
      if (!role) {
        return res.status(404).send({ message: 'Role not found' });
      }

      const currentPermissions =
        role.permissions?.[config.permissionType] || role[config.permissionType] || {};

      const mergedUpdates = {
        permissions: {
          ...role.permissions,
          [config.permissionType]: {
            ...currentPermissions,
            ...parsedUpdates,
          },
        },
      };

      const updatedRole = await updateRoleByName(roleName, mergedUpdates);
      res.status(200).send(updatedRole);
    } catch (error) {
      return res.status(400).send({ message: config.errorMessage, error: error.errors });
    }
  };
};

/**
 * GET /api/roles/:roleName
 * Get a specific role by name
 */
router.get('/:roleName', async (req, res) => {
  const { roleName } = req.params;

  try {
    let hasReadRoles = false;
    try {
      hasReadRoles = await hasCapability(req.user, SystemCapabilities.READ_ROLES);
    } catch (err) {
      logger.warn(`[GET /roles/:roleName] capability check failed: ${err.message}`);
    }
    const isOwnRole = req.user?.role === roleName;
    const isDefaultRole = Object.hasOwn(roleDefaults, roleName);
    if (!hasReadRoles && !isOwnRole && (roleName === SystemRoles.ADMIN || !isDefaultRole)) {
      return res.status(403).send({ message: 'Unauthorized' });
    }

    const role = await getRoleByName(roleName, '-_id -__v');
    if (!role) {
      return res.status(404).send({ message: 'Role not found' });
    }

    res.status(200).send(role);
  } catch (error) {
    logger.error('[GET /roles/:roleName] Error:', error);
    return res.status(500).send({ message: 'Failed to retrieve role' });
  }
});

/**
 * PUT /api/roles/:roleName/:permissionKey
 *
 * One route per permission type, each writing the role permissions the in-chat
 * admin panels edit. Registered from `permissionConfigs` so a new permission
 * type cannot arrive with the audit trail missing — these routes went unaudited
 * while the equivalent admin-panel endpoint recorded every change, which meant
 * granting all employees agent sharing left no trace.
 */
for (const [permissionKey, { permissionType }] of Object.entries(permissionConfigs)) {
  router.put(
    `/:roleName/${permissionKey}`,
    /** Before the gate, so a refused attempt is recorded too — see auditOnFinish. */
    auditRolePermissionUpdate(permissionType),
    manageRoles,
    createPermissionUpdateHandler(permissionKey),
  );
}

module.exports = router;
