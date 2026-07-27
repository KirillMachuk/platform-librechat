const createAuditOnFinish = require('./auditOnFinish');

/**
 * Records a manual credit change on a user's balance
 * (`PATCH /api/admin/users/:id/balance`).
 *
 * This moves money, and it was the one admin mutation with no trail at all:
 * `auditUserManagement` covers user CRUD and deliberately skips balance, while
 * the billing audit covers only operator-level top-ups of the shared pool.
 *
 * The fields an admin can set are all scalar, so they are recorded as sent —
 * the pre-change balance is not read here to keep the hook free of I/O.
 */
module.exports = createAuditOnFinish((req) => {
  const body = req.body ?? {};
  const metadata = {};

  for (const field of [
    'tokenCredits',
    'autoRefillEnabled',
    'refillIntervalValue',
    'refillIntervalUnit',
    'refillAmount',
  ]) {
    const value = body[field];
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
      metadata[field] = value;
    }
  }

  return {
    action: 'user.balance_update',
    targetType: 'user',
    targetId: req.params?.id,
    metadata,
  };
});
