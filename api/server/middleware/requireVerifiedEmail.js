const { logger } = require('@librechat/data-schemas');
const { checkEmailConfig } = require('@librechat/api');

/**
 * Blocks an action for users whose email is not yet verified — but only when an
 * email service is actually configured. Without email, verification can never
 * happen (self-hosted / no-SMTP), so gating there would permanently lock the
 * feature; in that case the middleware is a no-op.
 *
 * Used to keep unverified accounts (possible when ALLOW_UNVERIFIED_EMAIL_LOGIN
 * lets them sign in) from performing sensitive grants such as sharing a resource
 * with other principals.
 */
const requireVerifiedEmail = (req, res, next) => {
  if (!checkEmailConfig()) {
    return next();
  }
  if (req.user?.emailVerified) {
    return next();
  }
  logger.warn(
    `[requireVerifiedEmail] User ${req.user?.id} blocked from a share operation — email not verified`,
  );
  return res.status(403).json({
    error: 'Forbidden',
    message: 'Please verify your email address before sharing resources.',
  });
};

module.exports = requireVerifiedEmail;
