const express = require('express');
const request = require('supertest');

const mockRecordAudit = jest.fn();
jest.mock('~/server/services/Audit', () => ({
  recordAudit: (...args) => mockRecordAudit(...args),
  auditRequestContext: () => ({ ip: '9.9.9.9', userAgent: 'jest' }),
}));

const auditAdminAccessDenied = require('./auditAdminAccessDenied');

const STAFF = { _id: 'u1', email: 'staff@client.ru', role: 'USER' };

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
  beforeEach(() => mockRecordAudit.mockClear());

  it('records an employee who signed in but was refused the admin panel', async () => {
    await request(buildApp({})).get('/callback');

    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.login_failed',
        outcome: 'failure',
        actorEmail: 'staff@client.ru',
        metadata: { reason: 'admin_access_denied', provider: 'unknown' },
        ip: '9.9.9.9',
      }),
    );
  });

  it('stays out of the way when access is granted', async () => {
    await request(buildApp({ status: 200 })).get('/callback');

    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  /** A 403 before the strategy resolved anyone names nobody — better silent than wrong. */
  it('records nothing when there is no authenticated user', async () => {
    await request(buildApp({ user: null })).get('/callback');

    expect(mockRecordAudit).not.toHaveBeenCalled();
  });
});
