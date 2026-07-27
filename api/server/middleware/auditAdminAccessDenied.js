const { recordAudit, auditRequestContext } = require('~/server/services/Audit');

/**
 * Records a federated sign-in that the identity provider accepted but the admin
 * panel refused, i.e. an authenticated user without `ACCESS_ADMIN`.
 *
 * The generic audit hook only records successes, and the capability middleware
 * ends the request itself — so without this an employee trying the admin panel
 * left no trace at all, which is precisely the attempt a security review asks
 * about. Mount after the strategy (so the user is resolved) and before the
 * capability check.
 */
const auditAdminAccessDenied = (req, res, next) => {
  res.on('finish', () => {
    if (res.statusCode !== 403 || !req.user) {
      return;
    }
    recordAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      actorRole: req.user.role,
      action: 'auth.login_failed',
      outcome: 'failure',
      tenantId: req.user.tenantId,
      metadata: { reason: 'admin_access_denied', provider: req.user.provider ?? 'unknown' },
      ...auditRequestContext(req),
    });
  });
  next();
};

module.exports = auditAdminAccessDenied;
