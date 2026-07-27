const createAuditOnFinish = require('./auditOnFinish');

/** Keeps a flattened permission diff from growing an audit entry without bound. */
const MAX_PERMISSIONS_SUMMARY = 500;

/**
 * Routes under /api/admin/roles that mutate a role, and the action each records.
 * Keyed by method and route path so a renamed path fails the spec instead of
 * silently ending the trail; the spec asserts this table matches the router.
 */
const ROLE_AUDIT_ACTIONS = {
  'POST /': 'role.create',
  'PATCH /:name': 'role.update',
  'DELETE /:name': 'role.delete',
  'PATCH /:name/permissions': 'role.permissions_update',
  'POST /:name/members': 'role.member_add',
  'DELETE /:name/members/:userId': 'role.member_remove',
};

/**
 * Flattens a role permissions patch into one readable line, e.g.
 * `WEB_SEARCH.USE=false; AGENTS.CREATE=true`. The matrix is what an admin
 * actually changed, so recording only "permissions were updated" would leave
 * the security question ("who turned web search off for everyone?") unanswered,
 * and the audit metadata is a flat map that cannot hold the nested object.
 *
 * Stops once the cap is reached rather than joining everything and slicing:
 * the request body is only bounded by the 3 MB body limit.
 *
 * @param {unknown} permissions
 * @returns {string | undefined}
 */
function summarizePermissions(permissions) {
  if (!permissions || typeof permissions !== 'object') {
    return undefined;
  }

  const parts = [];
  let length = 0;

  for (const [type, bits] of Object.entries(permissions)) {
    if (!bits || typeof bits !== 'object') {
      continue;
    }
    for (const [bit, value] of Object.entries(bits)) {
      const part = `${type}.${bit}=${value}`;
      length += part.length + 2;
      if (length > MAX_PERMISSIONS_SUMMARY) {
        /* Include this part before cutting: with an oversized first entry the
           summary would otherwise be a lone ellipsis, naming no permission. */
        parts.push(part);
        return `${parts.join('; ').slice(0, MAX_PERMISSIONS_SUMMARY)}…`;
      }
      parts.push(part);
    }
  }

  return parts.length > 0 ? parts.join('; ') : undefined;
}

/**
 * Builds the entry for a mutating role route.
 * @param {import('express').Request} req
 * @returns {object|null}
 */
function resolveRoleAudit(req) {
  const action = ROLE_AUDIT_ACTIONS[`${req.method} ${req.route?.path ?? ''}`];
  if (!action) {
    return null;
  }

  const entry = { action, targetType: 'role', targetId: req.params?.name };

  if (action === 'role.create') {
    return {
      ...entry,
      targetId: typeof req.body?.name === 'string' ? req.body.name : undefined,
    };
  }
  if (action === 'role.permissions_update') {
    const permissions = summarizePermissions(req.body?.permissions);
    return { ...entry, metadata: permissions ? { permissions } : {} };
  }
  if (action === 'role.member_add') {
    return {
      ...entry,
      metadata: typeof req.body?.userId === 'string' ? { userId: req.body.userId } : {},
    };
  }
  if (action === 'role.member_remove') {
    return { ...entry, metadata: { userId: req.params?.userId } };
  }
  if (action === 'role.update') {
    return {
      ...entry,
      metadata: typeof req.body?.name === 'string' ? { newName: req.body.name } : {},
    };
  }
  return entry;
}

/**
 * Records role and permission changes under /api/admin/roles once they succeed.
 *
 * "An admin granted themselves rights" is the first question a security review
 * asks, and the roles endpoints answered it with silence: the whole router was
 * unaudited, while `permission.grant`/`revoke` cover only the separate
 * capability-grant endpoint.
 *
 * Attach per route — a router-level mount would not see `:name`/`:userId`,
 * which Express fills in only when the route layer runs.
 */
module.exports = createAuditOnFinish(resolveRoleAudit);
module.exports.resolveRoleAudit = resolveRoleAudit;
module.exports.ROLE_AUDIT_ACTIONS = ROLE_AUDIT_ACTIONS;
