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
 * Read from what the handler wrote, never from the request body. The body states
 * an intent, and an intent can be a no-op (enable what is already enabled) or be
 * rejected — either way there is no change to record, and an entry claiming
 * otherwise would make the journal lie. The handler leaves this behind only once
 * the write has gone through, so the recorded list is the one it produced.
 */
module.exports = createAuditOnFinish((req) => {
  const change = req.modelCatalogueChange;
  if (!change) {
    return null;
  }
  return {
    action: 'models.set_enabled',
    targetType: 'endpoint',
    targetId: change.endpoint,
    metadata: {
      model: change.model,
      enabled: change.enabled,
      count: change.models.length,
      models: change.models,
    },
  };
});
