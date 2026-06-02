const bcrypt = require('bcryptjs');
const express = require('express');
const { createAdminUsersHandlers } = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { getAppConfig } = require('~/server/services/Config');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);
const requireReadUsers = requireCapability(SystemCapabilities.READ_USERS);
const requireManageUsers = requireCapability(SystemCapabilities.MANAGE_USERS);

const handlers = createAdminUsersHandlers({
  findUsers: db.findUsers,
  countUsers: db.countUsers,
  findUser: db.findUser,
  createUser: db.createUser,
  updateUser: db.updateUser,
  deleteUserById: db.deleteUserById,
  deleteConfig: db.deleteConfig,
  deleteAclEntries: db.deleteAclEntries,
  hashPassword: (password) => bcrypt.hash(password, 10),
  getBalanceConfig: async () => {
    const appConfig = await getAppConfig({ baseOnly: true });
    return appConfig?.balance;
  },
});

router.use(requireJwtAuth, requireAdminAccess);

router.get('/', requireReadUsers, handlers.listUsers);
router.get('/search', requireReadUsers, handlers.searchUsers);
router.post('/', requireManageUsers, handlers.createUser);
router.patch('/:id', requireManageUsers, handlers.updateUser);
router.delete('/:id', requireManageUsers, handlers.deleteUser);

module.exports = router;
