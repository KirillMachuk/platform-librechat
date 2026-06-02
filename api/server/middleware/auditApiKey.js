const { recordAudit, auditRequestContext } = require('~/server/services/Audit');

const METHOD_ACTION = { POST: 'apikey.create', DELETE: 'apikey.revoke' };

/**
 * Records `apikey.create` / `apikey.revoke` after a successful Remote Agent Key
 * write. Attached on response `finish` (fire-and-forget, after the response,
 * skips status >= 400) so it never delays or breaks the request.
 */
const auditApiKey = (req, res, next) => {
  const action = METHOD_ACTION[req.method];
  if (action) {
    res.on('finish', () => {
      if (res.statusCode >= 400) {
        return;
      }
      recordAudit({
        actorId: req.user?._id,
        actorEmail: req.user?.email,
        actorRole: req.user?.role,
        action,
        targetType: 'apikey',
        targetId: req.params?.id,
        outcome: 'success',
        tenantId: req.user?.tenantId,
        metadata: typeof req.body?.name === 'string' ? { name: req.body.name } : undefined,
        ...auditRequestContext(req),
      });
    });
  }
  next();
};

module.exports = auditApiKey;
