const { recordAudit, auditRequestContext } = require('~/server/services/Audit');

/**
 * Builds an Express middleware that records an audit event once the response
 * settles. Recording is attached to response events, so it is fire-and-forget
 * and never delays or breaks the request.
 *
 * `resolve(req, outcome)` returns the event-specific fields (`action`,
 * `targetType`, `targetId`, `metadata`, …) or `null`/`undefined` to skip (e.g. a
 * method this hook does not audit). Actor, tenant, request context (ip/user-agent)
 * and the outcome are filled in automatically, so each hook stays a small,
 * declarative resolver.
 *
 * The outcome is handed to the resolver as well, because a resolver that reads
 * what the *handler* left behind cannot otherwise describe an `unknown`: at the
 * moment a socket dies the handler is still running and has left nothing yet, so
 * such a resolver answers null and the disconnect goes unrecorded — the very
 * thing the `unknown` branch exists to prevent. Resolvers that do not care simply
 * ignore the second argument.
 *
 * The resolver runs when the response settles, not on entry: hooks mounted with
 * `router.use` (grants, config) see an unmatched request, so `req.params` is
 * only populated once the route layer has run. A hook that needs route-scoped
 * state therefore has to be mounted per route.
 *
 * Outcomes:
 *  - `success` — the response completed with a status below 400.
 *  - `failure` — the request was denied (401/403). Recording these is the point
 *    of an audit trail as much as the successes are: "who kept trying to grant
 *    themselves rights" is a question the log has to be able to answer. Other
 *    4xx/5xx are skipped so validation noise does not drown the trail.
 *  - `unknown` — the client went away before the response was written (closed
 *    laptop, dropped VPN, killed connection). The handler keeps running in
 *    Node, so the change may be fully applied, partly applied, or not reached;
 *    the entry says so instead of guessing. Without this branch the entry was
 *    lost entirely, which made "disconnect mid-request" a way to mutate
 *    permissions and leave no trace.
 *
 * @param {(req: import('express').Request, outcome: 'success'|'failure'|'unknown') => (object|null|undefined)} resolve
 * @returns {import('express').RequestHandler}
 */
const createAuditOnFinish = (resolve) => (req, res, next) => {
  /** Both events fire on a normal response; the first one through wins. */
  let recorded = false;

  const record = (outcome) => {
    if (recorded) {
      return;
    }
    recorded = true;
    if (outcome == null) {
      return;
    }
    const fields = resolve(req, outcome);
    if (!fields) {
      return;
    }
    recordAudit({
      actorId: req.user?._id,
      actorEmail: req.user?.email,
      actorRole: req.user?.role,
      tenantId: req.user?.tenantId,
      outcome,
      ...fields,
      ...auditRequestContext(req),
    });
  };

  /** @returns {'success'|'failure'|null} null means "not worth an entry". */
  const outcomeForStatus = (statusCode) => {
    if (statusCode === 401 || statusCode === 403) {
      return 'failure';
    }
    return statusCode >= 400 ? null : 'success';
  };

  res.on('finish', () => record(outcomeForStatus(res.statusCode)));
  res.on('close', () => {
    /**
     * `close` also fires after a completed response. `writableEnded` separates
     * the two: true means the handler finished writing (and `finish` already
     * claimed the record), false means the socket died first.
     */
    record(res.writableEnded ? outcomeForStatus(res.statusCode) : 'unknown');
  });
  next();
};

module.exports = createAuditOnFinish;
