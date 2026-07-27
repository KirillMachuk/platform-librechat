const { SystemCapabilities } = require('@librechat/data-schemas');
const { recordAudit, auditRequestContext } = require('~/server/services/Audit');
const { hasCapability } = require('~/server/middleware/roles/capabilities');

/**
 * Records a sign-in that succeeded against the identity provider (or the local
 * password) but is about to be refused by the admin panel — an authenticated
 * user without `ACCESS_ADMIN`.
 *
 * The shared audit hook only records successes and the capability middleware
 * ends the request itself, so without this an employee trying the admin panel
 * left no trace — the first question a security review asks.
 *
 * The capability is re-checked here rather than inferred from a 403 on the way
 * out: `checkBan` answers 403 from the same chain, and a banned admin recorded
 * as "no rights" would be a false entry in the one table that has to be exact.
 * The extra read costs one query per sign-in.
 *
 * Mount immediately before `requireAdminAccess`, which still issues the refusal.
 */
const auditAdminAccessDenied = async (req, res, next) => {
  const id = req.user?.id ?? req.user?._id?.toString();
  if (!id) {
    return next();
  }

  try {
    const allowed = await hasCapability(
      { id, role: req.user.role ?? '', tenantId: req.user.tenantId },
      SystemCapabilities.ACCESS_ADMIN,
    );
    if (!allowed) {
      recordAudit({
        actorId: req.user._id,
        actorEmail: req.user.email,
        actorRole: req.user.role,
        tenantId: req.user.tenantId,
        action: 'auth.login_failed',
        outcome: 'failure',
        metadata: {
          provider: req.user.provider ?? 'local',
          reason: 'missing_capability',
          adminPanel: true,
        },
        ...auditRequestContext(req),
      });
    }
  } catch {
    /* Never block a sign-in over an audit read; requireAdminAccess decides access. */
  }

  next();
};

module.exports = auditAdminAccessDenied;
