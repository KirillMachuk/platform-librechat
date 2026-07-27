const express = require('express');
const request = require('supertest');

const mockRecordAudit = jest.fn();
const mockHasCapability = jest.fn();

jest.mock('~/server/services/Audit', () => ({
  recordAudit: (...args) => mockRecordAudit(...args),
  auditRequestContext: () => ({ ip: '9.9.9.9', userAgent: 'jest' }),
}));

jest.mock('~/server/middleware/roles/capabilities', () => ({
  hasCapability: (...args) => mockHasCapability(...args),
}));

jest.mock('@librechat/data-schemas', () => ({
  SystemCapabilities: { ACCESS_ADMIN: 'access:admin' },
}));

const auditAdminAccessDenied = require('./auditAdminAccessDenied');

const STAFF = { _id: 'u1', email: 'staff@client.ru', role: 'USER', provider: 'openid' };

/** `user: null` means the strategy resolved nobody — `undefined` would hit the default. */
function buildApp({ status = 403, user = STAFF }) {
  const app = express();
  app.get(
    '/callback',
    (req, res, next) => {
      if (user) {
        req.user = user;
      }
      next();
    },
    auditAdminAccessDenied,
    (req, res) => res.status(status).json({ ok: status < 400 }),
  );
  return app;
}

describe('auditAdminAccessDenied', () => {
  beforeEach(() => {
    mockRecordAudit.mockClear();
    mockHasCapability.mockReset();
  });

  it('records an employee who signed in but holds no admin access', async () => {
    mockHasCapability.mockResolvedValue(false);

    await request(buildApp({})).get('/callback');

    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.login_failed',
        outcome: 'failure',
        actorEmail: 'staff@client.ru',
        metadata: { provider: 'openid', reason: 'missing_capability', adminPanel: true },
        ip: '9.9.9.9',
      }),
    );
  });

  it('stays out of the way when the admin does hold access', async () => {
    mockHasCapability.mockResolvedValue(true);

    await request(buildApp({ status: 200 })).get('/callback');

    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  /**
   * checkBan answers 403 from the same chain. Reading the outgoing status
   * instead of the capability would file a banned admin as "no rights" — a
   * false entry in the one table that has to be exact.
   */
  it('does not blame missing rights for a refusal it did not cause', async () => {
    mockHasCapability.mockResolvedValue(true);

    await request(buildApp({ status: 403 })).get('/callback');

    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it('records nothing when there is no authenticated user', async () => {
    await request(buildApp({ user: null })).get('/callback');

    expect(mockHasCapability).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it('lets the sign-in proceed when the capability read fails', async () => {
    mockHasCapability.mockRejectedValue(new Error('db down'));

    const response = await request(buildApp({ status: 200 })).get('/callback');

    expect(response.status).toBe(200);
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });
});
