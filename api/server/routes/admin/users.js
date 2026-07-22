const bcrypt = require('bcryptjs');
const express = require('express');
const {
  createAdminUsersHandlers,
  createAdminBalanceHandlers,
  readBillingConfig,
} = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { getAppConfig } = require('~/server/services/Config');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { requireJwtAuth } = require('~/server/middleware');
const auditUserManagement = require('~/server/middleware/auditUserManagement');
const db = require('~/models');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);
const requireReadUsers = requireCapability(SystemCapabilities.READ_USERS);
const requireManageUsers = requireCapability(SystemCapabilities.MANAGE_USERS);

/* Operator accounts move money and see $ figures; the client's own admin holds
 * MANAGE_USERS, so they are shielded here from being taken over via a password reset. */
const { operatorEmails } = readBillingConfig();

const handlers = createAdminUsersHandlers({
  protectedEmails: operatorEmails,
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

const balanceHandlers = createAdminBalanceHandlers({
  findUser: db.findUser,
  findBalanceByUser: db.findBalanceByUser,
  findBalancesByUsers: db.findBalancesByUsers,
  upsertBalanceFields: db.upsertBalanceFields,
});

router.use(requireJwtAuth, requireAdminAccess);

router.get('/', requireReadUsers, handlers.listUsers);
router.get('/search', requireReadUsers, handlers.searchUsers);
router.get('/balances', requireReadUsers, balanceHandlers.getUsersBalances);
router.post('/', requireManageUsers, auditUserManagement, handlers.createUser);
router.get('/:id/balance', requireReadUsers, balanceHandlers.getUserBalance);
router.patch('/:id/balance', requireManageUsers, balanceHandlers.setUserBalance);
router.patch('/:id', requireManageUsers, auditUserManagement, handlers.updateUser);
router.delete('/:id', requireManageUsers, auditUserManagement, handlers.deleteUser);

module.exports = router;
