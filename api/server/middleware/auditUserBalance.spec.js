const express = require('express');
const request = require('supertest');

const mockRecordAudit = jest.fn();
jest.mock('~/server/services/Audit', () => ({
  recordAudit: (...args) => mockRecordAudit(...args),
  auditRequestContext: () => ({ ip: '9.9.9.9', userAgent: 'jest' }),
}));

const auditUserBalance = require('./auditUserBalance');

function buildApp(status = 200) {
  const app = express();
  const router = express.Router();
  router.use((req, res, next) => {
    req.user = { _id: 'admin1', email: 'admin@x.io', role: 'ADMIN' };
    next();
  });
  router.patch('/:id/balance', auditUserBalance, (req, res) =>
    res.status(status).json({ ok: true }),
  );
  app.use(express.json());
  app.use('/api/admin/users', router);
  return app;
}

describe('auditUserBalance', () => {
  beforeEach(() => mockRecordAudit.mockClear());

  it('names the user whose balance changed and what was set', async () => {
    await request(buildApp())
      .patch('/api/admin/users/u42/balance')
      .send({ tokenCredits: 50000, autoRefillEnabled: true });

    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'user.balance_update',
        targetType: 'user',
        targetId: 'u42',
        metadata: { tokenCredits: 50000, autoRefillEnabled: true },
      }),
    );
  });

  it('ignores fields it does not recognise instead of storing them', async () => {
    await request(buildApp())
      .patch('/api/admin/users/u42/balance')
      .send({ tokenCredits: 1, note: { nested: 'object' } });

    expect(mockRecordAudit.mock.calls[0][0].metadata).toEqual({ tokenCredits: 1 });
  });

  it('records nothing when the change was rejected', async () => {
    await request(buildApp(403)).patch('/api/admin/users/u42/balance').send({ tokenCredits: 1 });

    expect(mockRecordAudit).not.toHaveBeenCalled();
  });
});
