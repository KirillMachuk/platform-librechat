const express = require('express');
const { logger } = require('@librechat/data-schemas');
const { formatClientErrorMessage, sanitizeClientErrorReport } = require('@librechat/api');
const { clientErrorLimiter } = require('~/server/middleware');

/**
 * Where browser failures go to be seen.
 *
 * Every error boundary in this app ends at `console.error`, in a browser nobody
 * watches, and `ApiErrorWatcher` is upstream's stub. The platform's OTLP RUM proxy
 * forwards to a collector this contour does not run. So a user whose screen fell
 * apart was invisible unless they said so; this writes the failure into the
 * platform's own error log, where the deploy repo's daily digest already looks.
 *
 * Unauthenticated on purpose: the reports most worth having come from the login
 * screen, where there is no session yet. The trade is a public write into a log
 * file, which is why the payload is capped, the fields are an allow-list, and the
 * limiter drops the excess instead of answering.
 */
const router = express.Router();

router.post('/', clientErrorLimiter, express.json({ limit: '8kb' }), (req, res) => {
  res.status(202).json({ ok: true });

  const report = sanitizeClientErrorReport(req.body);
  if (!report) {
    return;
  }
  logger.error(formatClientErrorMessage(report), {
    stack: report.stack,
    path: report.path,
    userId: req.user?.id,
  });
});

module.exports = router;
