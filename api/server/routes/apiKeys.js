const express = require('express');
const { generateCheckAccess, createApiKeyHandlers } = require('@librechat/api');
const { PermissionTypes, Permissions } = require('librechat-data-provider');
const {
  getAgentApiKeyById,
  createAgentApiKey,
  deleteAgentApiKey,
  listAgentApiKeys,
  getRoleByName,
} = require('~/models');
const { requireJwtAuth } = require('~/server/middleware');
const auditApiKey = require('~/server/middleware/auditApiKey');

const router = express.Router();

const handlers = createApiKeyHandlers({
  createAgentApiKey,
  listAgentApiKeys,
  deleteAgentApiKey,
  getAgentApiKeyById,
});

const checkRemoteAgentsUse = generateCheckAccess({
  permissionType: PermissionTypes.REMOTE_AGENTS,
  permissions: [Permissions.USE],
  getRoleByName,
});

router.post('/', requireJwtAuth, checkRemoteAgentsUse, auditApiKey, handlers.createApiKey);

router.get('/', requireJwtAuth, checkRemoteAgentsUse, handlers.listApiKeys);

router.get('/:id', requireJwtAuth, checkRemoteAgentsUse, handlers.getApiKey);

router.delete('/:id', requireJwtAuth, checkRemoteAgentsUse, auditApiKey, handlers.deleteApiKey);

module.exports = router;
