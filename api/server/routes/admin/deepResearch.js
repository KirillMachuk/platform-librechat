const express = require('express');
const { createDeepResearchSettingsHandlers } = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { getAppConfig, invalidateConfigCaches } = require('~/server/services/Config');
const { getModelsConfig } = require('~/server/controllers/ModelController');
const { requireJwtAuth } = require('~/server/middleware');
const auditDeepResearchChange = require('~/server/middleware/auditDeepResearchChange');
const db = require('~/models');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);

const handlers = createDeepResearchSettingsHandlers({
  getAppConfig,
  getModelsConfig,
  patchConfigFields: db.patchConfigFields,
  invalidateConfigCaches,
});

router.use(requireJwtAuth, requireAdminAccess);
router.use(auditDeepResearchChange);

router.get('/', handlers.getSettings);
router.put('/', handlers.setActiveMode);
router.put('/models', handlers.setModeModels);

module.exports = router;
