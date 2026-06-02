const createAuditOnFinish = require('./auditOnFinish');

/**
 * Records `permission.grant` (POST) / `permission.revoke` (DELETE) after a
 * successful capability change under /api/admin/grants. Captures the principal
 * (type + id) and the capability involved.
 */
module.exports = createAuditOnFinish((req) => {
  if (req.method === 'POST') {
    return {
      action: 'permission.grant',
      targetType: 'grant',
      targetId: typeof req.body?.principalId === 'string' ? req.body.principalId : undefined,
      metadata: {
        principalType: typeof req.body?.principalType === 'string' ? req.body.principalType : '',
        capability: typeof req.body?.capability === 'string' ? req.body.capability : '',
      },
    };
  }
  if (req.method === 'DELETE') {
    return {
      action: 'permission.revoke',
      targetType: 'grant',
      targetId: req.params?.principalId,
      metadata: {
        principalType: req.params?.principalType ?? '',
        capability: req.params?.capability ? decodeURIComponent(req.params.capability) : '',
      },
    };
  }
  return null;
});
