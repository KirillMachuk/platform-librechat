const { recordAudit, auditRequestContext } = require('~/server/services/Audit');

/**
 * Records a `file.upload` event after a successful file upload. Mounted only on
 * the content-upload routes (documents/images), after multer has populated
 * `req.file`. Attached on response `finish` — fire-and-forget, skips status >= 400.
 */
const auditFileUpload = (req, res, next) => {
  res.on('finish', () => {
    if (res.statusCode >= 400) {
      return;
    }
    const file = req.file;
    recordAudit({
      actorId: req.user?._id,
      actorEmail: req.user?.email,
      actorRole: req.user?.role,
      action: 'file.upload',
      targetType: 'file',
      targetId: typeof req.body?.file_id === 'string' ? req.body.file_id : undefined,
      outcome: 'success',
      tenantId: req.user?.tenantId,
      metadata: file
        ? {
            filename: typeof file.originalname === 'string' ? file.originalname : '',
            size: typeof file.size === 'number' ? file.size : 0,
            mimetype: typeof file.mimetype === 'string' ? file.mimetype : '',
          }
        : undefined,
      ...auditRequestContext(req),
    });
  });
  next();
};

module.exports = auditFileUpload;
