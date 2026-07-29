const createAuditOnFinish = require('./auditOnFinish');

const METHOD_ACTION = { POST: 'apikey.create', DELETE: 'apikey.revoke' };

/**
 * Records `apikey.create` / `apikey.revoke` after a successful Remote Agent Key
 * write. Captures the key id (delete) and the key name (create).
 */
module.exports = createAuditOnFinish((req) => {
  const action = METHOD_ACTION[req.method];
  if (!action) {
    return null;
  }
  return {
    action,
    targetType: 'apikey',
    /** POST has no `:id` — the handler puts the minted key's id on the request. */
    targetId: req.auditApiKeyId ?? req.params?.id,
    metadata: typeof req.body?.name === 'string' ? { name: req.body.name } : undefined,
  };
});
