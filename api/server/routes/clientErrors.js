const express = require('express');
const { logger } = require('@librechat/data-schemas');
const { formatClientErrorMessage, sanitizeClientErrorReport } = require('@librechat/api');
const optionalJwtAuth = require('~/server/middleware/optionalJwtAuth');
const { clientErrorLimiter, clientErrorGlobalLimiter } = require('~/server/middleware');

/**
 * Where browser failures go to be seen.
 *
 * Every error boundary in this app ends at `console.error`, in a browser nobody
 * watches, and `ApiErrorWatcher` is upstream's stub. The platform's OTLP RUM proxy
 * forwards to a collector this contour does not run. So a user whose screen fell
 * apart was invisible unless they said so; this writes the failure into the
 * platform's own error log, where the deploy repo's daily digest already looks.
 *
 * Sign-in is optional, not required: the reports most worth having come from the
 * login screen, where there is no session yet, and `optionalJwtAuth` attaches the
 * user when there is one so a real report can be told apart from an anonymous one.
 *
 * The trade is a public write into a log file, bounded three ways: an allow-list
 * rather than a filter, a per-IP limiter, and a shared ceiling that holds even when
 * the per-IP one does not — behind a proxy the client IP comes from a header the
 * caller can write, so the per-IP bucket alone is a courtesy, not a bound.
 */
const router = express.Router();

/* No `express.json` here: the app-wide parser at 3 MB has already read the body by
 * the time this router is reached, so a stricter limit on this route would be a
 * comment pretending to be a control. The size is absorbed in `clip` instead. */
router.post(
  '/',
  clientErrorGlobalLimiter,
  clientErrorLimiter,
  optionalJwtAuth,
  (req, res) => {
    const report = sanitizeClientErrorReport(req.body);
    if (report) {
      logger.error(formatClientErrorMessage(report), {
        stack: report.stack,
        path: report.path,
        userId: req.user?.id,
      });
    }
    /* Answered last, and deliberately: the work above is microseconds of string
     * handling, while replying first leaves any future throw inside this handler to
     * reach an error middleware that does not check `headersSent` — which shows up
     * as a severed connection rather than as an error. */
    res.status(202).json({ ok: true });
  },
);

module.exports = router;
