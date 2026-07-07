const createAuditOnFinish = require('./auditOnFinish');

/**
 * Records admin user-management mutations under /api/admin/users after they
 * succeed: `user.create` (POST), `user.update` (PATCH), `user.delete` (DELETE).
 *
 * The role assigned/changed is the security-sensitive field (an admin promoting
 * another account to ADMIN), so it is captured in metadata. Passwords and other
 * PII in the body are never read.
 *
 * Attach per-route to the mutating endpoints only — reads and balance routes are
 * intentionally not covered here.
 */
module.exports = createAuditOnFinish((req) => {
  const role = typeof req.body?.role === 'string' ? req.body.role : undefined;

  if (req.method === 'POST') {
    return {
      action: 'user.create',
      targetType: 'user',
      metadata: role ? { role } : {},
    };
  }
  if (req.method === 'PATCH') {
    return {
      action: 'user.update',
      targetType: 'user',
      targetId: req.params?.id,
      metadata: role ? { role } : {},
    };
  }
  if (req.method === 'DELETE') {
    return {
      action: 'user.delete',
      targetType: 'user',
      targetId: req.params?.id,
    };
  }
  return null;
});
