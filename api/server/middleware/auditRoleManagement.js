const createAuditOnFinish = require('./auditOnFinish');

/** Keeps a flattened permission diff from growing an audit entry without bound. */
const MAX_PERMISSIONS_SUMMARY = 500;

/**
 * Flattens a role permissions patch into one readable line, e.g.
 * `WEB_SEARCH.USE=false; AGENTS.CREATE=true`. The matrix is what an admin
 * actually changed, so recording only "permissions were updated" would leave
 * the security question ("who turned web search off for everyone?") unanswered,
 * and the audit metadata is a flat map that cannot hold the nested object.
 *
 * @param {unknown} permissions
 * @returns {string | undefined}
 */
function summarizePermissions(permissions) {
  if (!permissions || typeof permissions !== 'object') {
    return undefined;
  }

  const parts = [];
  for (const [type, bits] of Object.entries(permissions)) {
    if (!bits || typeof bits !== 'object') {
      continue;
    }
    for (const [bit, value] of Object.entries(bits)) {
      parts.push(`${type}.${bit}=${value}`);
    }
  }

  if (parts.length === 0) {
    return undefined;
  }

  const summary = parts.join('; ');
  return summary.length > MAX_PERMISSIONS_SUMMARY
    ? `${summary.slice(0, MAX_PERMISSIONS_SUMMARY)}…`
    : summary;
}

/**
 * Records role and permission changes under /api/admin/roles once they succeed.
 *
 * "An admin granted themselves rights" is the first question a security review
 * asks, and the roles endpoints answered it with silence: the whole router was
 * unaudited, while `permission.grant`/`revoke` cover only the separate
 * capability-grant endpoint.
 *
 * Attach per-route to the mutating endpoints — a router-level mount would not
 * see `:name`/`:userId`, which Express fills in per route.
 */
module.exports = createAuditOnFinish((req) => {
  /* Route path, not method: POST, PATCH and DELETE each serve two endpoints here. */
  const route = req.route?.path ?? '';
  const roleName = req.params?.name;

  if (route === '/' && req.method === 'POST') {
    return {
      action: 'role.create',
      targetType: 'role',
      targetId: typeof req.body?.name === 'string' ? req.body.name : undefined,
    };
  }
  if (route === '/:name/permissions' && req.method === 'PATCH') {
    const permissions = summarizePermissions(req.body?.permissions);
    return {
      action: 'role.permissions_update',
      targetType: 'role',
      targetId: roleName,
      metadata: permissions ? { permissions } : {},
    };
  }
  if (route === '/:name/members' && req.method === 'POST') {
    return {
      action: 'role.member_add',
      targetType: 'role',
      targetId: roleName,
      metadata: typeof req.body?.userId === 'string' ? { userId: req.body.userId } : {},
    };
  }
  if (route === '/:name/members/:userId' && req.method === 'DELETE') {
    return {
      action: 'role.member_remove',
      targetType: 'role',
      targetId: roleName,
      metadata: { userId: req.params?.userId },
    };
  }
  if (route === '/:name' && req.method === 'PATCH') {
    return {
      action: 'role.update',
      targetType: 'role',
      targetId: roleName,
      metadata: typeof req.body?.name === 'string' ? { newName: req.body.name } : {},
    };
  }
  if (route === '/:name' && req.method === 'DELETE') {
    return { action: 'role.delete', targetType: 'role', targetId: roleName };
  }
  return null;
});
