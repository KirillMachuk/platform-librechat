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
 * @param {(req: import('express').Request) => (object|null|undefined)} resolve
 * @returns {import('express').RequestHandler}
 */
const createAuditOnFinish = (resolve) => (req, res, next) => {
  res.on('finish', () => {
    if (res.statusCode >= 400) {
      return;
    }
    const fields = resolve(req);
    if (!fields) {
      return;
    }
    recordAudit({
      actorId: req.user?._id,
      actorEmail: req.user?.email,
      actorRole: req.user?.role,
      tenantId: req.user?.tenantId,
      outcome: 'success',
      ...fields,
      ...auditRequestContext(req),
    });
  });
  next();
};

module.exports = createAuditOnFinish;
