const createAuditOnFinish = require('./auditOnFinish');

/**
 * Records `file.upload` after a successful content upload. Mounted only on the
 * document/image upload routes (after multer populates `req.file`), so avatars
 * and speech-to-text are not audited as uploads.
 */
module.exports = createAuditOnFinish((req) => {
  const file = req.file;
  return {
    action: 'file.upload',
    targetType: 'file',
    targetId: typeof req.body?.file_id === 'string' ? req.body.file_id : undefined,
    metadata: file
      ? {
          filename: typeof file.originalname === 'string' ? file.originalname : '',
          size: typeof file.size === 'number' ? file.size : 0,
          mimetype: typeof file.mimetype === 'string' ? file.mimetype : '',
        }
      : undefined,
  };
});
