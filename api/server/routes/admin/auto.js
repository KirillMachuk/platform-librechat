const express = require('express');
const { createAutoSettingsHandlers } = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { getAppConfig, invalidateConfigCaches } = require('~/server/services/Config');
const { requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();

const handlers = createAutoSettingsHandlers({
  getAppConfig,
  patchConfigFields: db.patchConfigFields,
  invalidateConfigCaches,
});

router.use(requireJwtAuth, requireCapability(SystemCapabilities.ACCESS_ADMIN));

router.get('/', handlers.getSettings);
router.put('/', handlers.setActiveMode);

module.exports = router;
