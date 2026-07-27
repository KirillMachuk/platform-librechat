const express = require('express');
const { createAdminRolesHandlers } = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { requireJwtAuth } = require('~/server/middleware');
const auditRoleManagement = require('~/server/middleware/auditRoleManagement');
const db = require('~/models');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);
const requireReadRoles = requireCapability(SystemCapabilities.READ_ROLES);
const requireManageRoles = requireCapability(SystemCapabilities.MANAGE_ROLES);

const handlers = createAdminRolesHandlers({
  listRoles: db.listRoles,
  countRoles: db.countRoles,
  getRoleByName: db.getRoleByName,
  createRoleByName: db.createRoleByName,
  updateRoleByName: db.updateRoleByName,
  updateAccessPermissions: db.updateAccessPermissions,
  deleteRoleByName: db.deleteRoleByName,
  findUser: db.findUser,
  updateUser: db.updateUser,
  updateUsersByRole: db.updateUsersByRole,
  findUserIdsByRole: db.findUserIdsByRole,
  updateUsersRoleByIds: db.updateUsersRoleByIds,
  listUsersByRole: db.listUsersByRole,
  countUsersByRole: db.countUsersByRole,
  deleteConfig: db.deleteConfig,
  deleteAclEntries: db.deleteAclEntries,
  deleteGrantsForPrincipal: db.deleteGrantsForPrincipal,
});

router.use(requireJwtAuth, requireAdminAccess);

router.get('/', requireReadRoles, handlers.listRoles);
router.post('/', requireManageRoles, auditRoleManagement, handlers.createRole);
router.get('/:name', requireReadRoles, handlers.getRole);
router.patch('/:name', requireManageRoles, auditRoleManagement, handlers.updateRole);
router.delete('/:name', requireManageRoles, auditRoleManagement, handlers.deleteRole);
router.patch(
  '/:name/permissions',
  requireManageRoles,
  auditRoleManagement,
  handlers.updateRolePermissions,
);
router.get('/:name/members', requireReadRoles, handlers.getRoleMembers);
router.post('/:name/members', requireManageRoles, auditRoleManagement, handlers.addRoleMember);
router.delete(
  '/:name/members/:userId',
  requireManageRoles,
  auditRoleManagement,
  handlers.removeRoleMember,
);

module.exports = router;
