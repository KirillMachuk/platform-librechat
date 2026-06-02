const passport = require('passport');
const { logger } = require('@librechat/data-schemas');
const { recordAudit, auditRequestContext } = require('~/server/services/Audit');

const recordFailedLogin = (req, reason) => {
  recordAudit({
    action: 'auth.login_failed',
    outcome: 'failure',
    actorEmail: typeof req.body?.email === 'string' ? req.body.email : undefined,
    metadata: { reason },
    ...auditRequestContext(req),
  });
};

const requireLocalAuth = (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) {
      logger.error('[requireLocalAuth] Error at passport.authenticate:', err);
      return next(err);
    }
    if (!user) {
      logger.debug('[requireLocalAuth] Error: No user');
      recordFailedLogin(req, 'user_not_found');
      return res.status(404).send(info);
    }
    if (info && info.message) {
      logger.debug('[requireLocalAuth] Error: ' + info.message);
      recordFailedLogin(req, info.message);
      return res.status(422).send({ message: info.message });
    }
    req.user = user;
    next();
  })(req, res, next);
};

module.exports = requireLocalAuth;
