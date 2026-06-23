const express = require('express');
const { createDeepResearchSettingsHandlers } = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { getAppConfig, invalidateConfigCaches } = require('~/server/services/Config');
const { requireJwtAuth } = require('~/server/middleware');
const auditConfigChange = require('~/server/middleware/auditConfigChange');
const db = require('~/models');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);

const handlers = createDeepResearchSettingsHandlers({
  getAppConfig,
  patchConfigFields: db.patchConfigFields,
  invalidateConfigCaches,
});

router.use(requireJwtAuth, requireAdminAccess);
router.use(auditConfigChange);

router.get('/', handlers.getSettings);
router.put('/', handlers.setActiveMode);

module.exports = router;
