const express = require('express');
const { restoreTenantContextFromReq } = require('@librechat/api');
const {
  createFileLimiters,
  configMiddleware,
  requireJwtAuth,
  uaParser,
  checkBan,
} = require('~/server/middleware');
const { createMulterInstance } = require('~/server/routes/files/multer');

const projects = require('./projects');
const files = require('./files');

const initialize = async () => {
  const router = express.Router();
  router.use(requireJwtAuth);
  router.use(configMiddleware);
  router.use(checkBan);
  router.use(uaParser);

  const upload = await createMulterInstance();
  const { fileUploadIpLimiter, fileUploadUserLimiter } = createFileLimiters();

  router.post(
    '/:projectId/files',
    (req, res, next) =>
      fileUploadIpLimiter(req, res, (err) => {
        if (err) {
          return next(err);
        }
        return fileUploadUserLimiter(req, res, next);
      }),
    upload.single('file'),
    restoreTenantContextFromReq,
  );

  router.use('/:projectId/files', files);
  router.use('/', projects);

  return router;
};

module.exports = { initialize };
