const { recordAudit, auditRequestContext } = require('~/server/services/Audit');

const WRITE_METHODS = new Set(['PUT', 'PATCH', 'DELETE']);

/**
 * Records an `admin.config_change` audit event after a successful config write
 * (PUT/PATCH/DELETE). Attached on response `finish` so it never delays or breaks
 * the response; failed writes (status >= 400) are not recorded.
 */
const auditConfigChange = (req, res, next) => {
  if (WRITE_METHODS.has(req.method)) {
    res.on('finish', () => {
      if (res.statusCode >= 400) {
        return;
      }
      recordAudit({
        actorId: req.user?._id,
        actorEmail: req.user?.email,
        actorRole: req.user?.role,
        action: 'admin.config_change',
        targetType: 'config',
        targetId: req.params?.principalId,
        outcome: 'success',
        tenantId: req.user?.tenantId,
        metadata: {
          method: req.method,
          principalType: req.params?.principalType ?? '',
        },
        ...auditRequestContext(req),
      });
    });
  }
  next();
};

module.exports = auditConfigChange;
