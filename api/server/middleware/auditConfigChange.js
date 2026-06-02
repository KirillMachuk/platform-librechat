const createAuditOnFinish = require('./auditOnFinish');

const WRITE_METHODS = new Set(['PUT', 'PATCH', 'DELETE']);

/**
 * Records `admin.config_change` after a successful config write (PUT/PATCH/DELETE)
 * under /api/admin/config. Reads/deletes (GET) are skipped.
 */
module.exports = createAuditOnFinish((req) => {
  if (!WRITE_METHODS.has(req.method)) {
    return null;
  }
  return {
    action: 'admin.config_change',
    targetType: 'config',
    targetId: req.params?.principalId,
    metadata: {
      method: req.method,
      principalType: req.params?.principalType ?? '',
    },
  };
});
