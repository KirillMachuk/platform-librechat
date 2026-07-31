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
module.exports = createAuditOnFinish((req, outcome) => {
  const change = req.modelCatalogueChange;
  if (change) {
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
  }

  /**
   * The client went away while the handler was still working, so there is nothing
   * to read: the write may land a moment from now, or never.
   *
   * Silence here would be worse than an imprecise entry. Enabling a model asks the
   * gateway whether it will serve it, which is a real round trip an admin has
   * every reason to walk away from — and the handler carries on in Node either
   * way, so "closed the tab mid-save" must not be a way to change what every
   * employee can select and leave no trace. The body is an intent rather than an
   * outcome, and the entry says so.
   */
  if (outcome === 'unknown') {
    const { endpoint, model, enabled } = req.body ?? {};
    if (typeof endpoint !== 'string' || typeof model !== 'string') {
      return null;
    }
    return {
      action: 'models.set_enabled',
      targetType: 'endpoint',
      targetId: endpoint,
      metadata: { model, enabled, applied: false },
    };
  }

  return null;
});
