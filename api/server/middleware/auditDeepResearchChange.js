const createAuditOnFinish = require('./auditOnFinish');

/**
 * Records Deep Research admin changes under /api/admin/deep-research after a
 * successful write:
 *  - PUT /        (active depth tier)    → deep_research.set_active_mode
 *  - PUT /models  (per-mode lead/worker) → deep_research.set_models
 *
 * The generic config-change auditor can't capture these: the routes carry no
 * principalType/principalId params, so it would log an empty target. Here the
 * actual change (tier + chosen models) is read from the validated body and kept
 * in targetId + metadata, so the feed answers "who switched DR to <mode> / set
 * <model> when". Branching on body shape is safe — the two routes have disjoint
 * bodies and the handler 400s (un-audited) on anything malformed.
 */
module.exports = createAuditOnFinish((req) => {
  if (req.method !== 'PUT') {
    return null;
  }
  const body = req.body ?? {};

  if (typeof body.mode === 'string') {
    const metadata = { mode: body.mode };
    if (typeof body.leadModel === 'string') {
      metadata.leadModel = body.leadModel;
    }
    if (typeof body.workerModel === 'string') {
      metadata.workerModel = body.workerModel;
    }
    return {
      action: 'deep_research.set_models',
      targetType: 'deep_research',
      targetId: body.mode,
      metadata,
    };
  }

  if (typeof body.activeMode === 'string') {
    return {
      action: 'deep_research.set_active_mode',
      targetType: 'deep_research',
      targetId: body.activeMode,
      metadata: { activeMode: body.activeMode },
    };
  }

  return null;
});
