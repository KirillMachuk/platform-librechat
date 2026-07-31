const express = require('express');
const { createModelCatalogueHandlers, fetchModelCapabilities } = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const {
  requireCapability,
  hasConfigCapability,
} = require('~/server/middleware/roles/capabilities');
const { getAppConfig, invalidateConfigCaches } = require('~/server/services/Config');
const { requireJwtAuth } = require('~/server/middleware');
const auditModelCatalogueChange = require('~/server/middleware/auditModelCatalogueChange');
const db = require('~/models');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);

const handlers = createModelCatalogueHandlers({
  getAppConfig,
  fetchModelCapabilities,
  countAgentsByModel: db.countAgentsByModel,
  findConfigByPrincipal: db.findConfigByPrincipal,
  patchConfigFields: db.patchConfigFields,
  invalidateConfigCaches,
  hasConfigCapability,
});

router.use(requireJwtAuth, requireAdminAccess);
router.use(auditModelCatalogueChange);

router.get('/', handlers.getCatalogue);
router.put('/', handlers.setModels);

module.exports = router;
