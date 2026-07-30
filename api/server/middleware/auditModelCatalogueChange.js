const createAuditOnFinish = require('./auditOnFinish');

/**
 * Records which models an admin left enabled, after a successful write under
 * /api/admin/models.
 *
 * The generic config-change auditor cannot capture this: the route carries no
 * principalType/principalId params, so it would log an empty target. The list
 * itself is the change worth keeping — "who narrowed the line-up to these
 * thirteen, and when" is the question this feed has to answer, especially since
 * disabling a model stops employees from selecting it.
 *
 * Only the count and the ids go in; the handler 400s (un-audited) on anything
 * malformed, so a recorded entry always reflects a list that was applied.
 */
module.exports = createAuditOnFinish((req) => {
  if (req.method !== 'PUT') {
    return null;
  }
  const body = req.body ?? {};
  if (typeof body.endpoint !== 'string' || !Array.isArray(body.models)) {
    return null;
  }
  return {
    action: 'models.set_enabled',
    targetType: 'endpoint',
    targetId: body.endpoint,
    metadata: {
      count: body.models.length,
      models: body.models.filter((model) => typeof model === 'string'),
    },
  };
});
