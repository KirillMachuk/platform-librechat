const { recordAudit, auditRequestContext } = require('~/server/services/Audit');

/**
 * Builds an Express middleware that records an audit event once the response
 * finishes successfully (status < 400). Recording is attached to the response
 * `finish` event, so it is fire-and-forget and never delays or breaks the request.
 *
 * `resolve(req)` returns the event-specific fields (`action`, `targetType`,
 * `targetId`, `metadata`, …) or `null`/`undefined` to skip (e.g. a method this
 * hook does not audit). Actor, tenant, request context (ip/user-agent) and a
 * `success` outcome are filled in automatically, so each hook stays a small,
 * declarative resolver.
 *
 * The resolver reads the request *before* the handler runs, and only the
 * recording waits for `finish`: `req.params`, `req.route` and `req.body` are
 * layer-scoped state that Express is free to restore once a route completes,
 * so resolving late risks an entry that names no target.
 *
 * @param {(req: import('express').Request) => (object|null|undefined)} resolve
 * @returns {import('express').RequestHandler}
 */
const createAuditOnFinish = (resolve) => (req, res, next) => {
  const fields = resolve(req);
  if (fields) {
    const context = {
      actorId: req.user?._id,
      actorEmail: req.user?.email,
      actorRole: req.user?.role,
      tenantId: req.user?.tenantId,
      outcome: 'success',
      ...fields,
      ...auditRequestContext(req),
    };
    res.on('finish', () => {
      if (res.statusCode >= 400) {
        return;
      }
      recordAudit(context);
    });
  }
  next();
};

module.exports = createAuditOnFinish;
