import { Types } from 'mongoose';
import type { IAuditLog } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import type { AdminAuditDeps } from './audit';
import { createAdminAuditHandlers } from './audit';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

function mockEntry(overrides: Partial<IAuditLog> = {}): IAuditLog {
  return {
    _id: new Types.ObjectId(),
    actorId: new Types.ObjectId(),
    actorEmail: 'user@example.com',
    action: 'llm.message',
    conversationId: 'conv-1',
    model: 'gpt-x',
    tokens: { input: 0, output: 300, total: 300 },
    outcome: 'success',
    createdAt: new Date('2026-03-15T00:00:00.000Z'),
    ...overrides,
  } as IAuditLog;
}

function createReqRes(query: Record<string, string | string[]> = {}) {
  const req = {
    params: {},
    query,
    body: {},
    user: { _id: new Types.ObjectId(), role: 'admin' },
  } as unknown as ServerRequest;

  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;

  return { req, res, status, json };
}

function createDeps(overrides: Partial<AdminAuditDeps> = {}): AdminAuditDeps {
  return {
    getAuditLogs: jest.fn().mockResolvedValue([]),
    countAuditLogs: jest.fn().mockResolvedValue(0),
    backfillAuditFromTransactions: jest.fn().mockResolvedValue({ scanned: 0, inserted: 0 }),
    backfillAgentInvokes: jest.fn().mockResolvedValue({ scanned: 0, inserted: 0 }),
    ...overrides,
  };
}

describe('createAdminAuditHandlers', () => {
  describe('listAudit', () => {
    it('returns mapped entries with pagination metadata', async () => {
      const getAuditLogs = jest.fn().mockResolvedValue([mockEntry()]);
      const countAuditLogs = jest.fn().mockResolvedValue(1);
      const deps = createDeps({ getAuditLogs, countAuditLogs });
      const handlers = createAdminAuditHandlers(deps);
      const { req, res, status, json } = createReqRes();

      await handlers.listAudit(req, res);

      expect(status).toHaveBeenCalledWith(200);
      const body = json.mock.calls[0][0];
      expect(body.total).toBe(1);
      expect(body).toHaveProperty('limit');
      expect(body).toHaveProperty('offset');
      expect(body.entries[0]).toMatchObject({
        action: 'llm.message',
        actorEmail: 'user@example.com',
        outcome: 'success',
        createdAt: '2026-03-15T00:00:00.000Z',
      });
      expect(body.entries[0].tokens.total).toBe(300);
    });

    it('passes action, conversation and date filters through', async () => {
      const getAuditLogs = jest.fn().mockResolvedValue([]);
      const deps = createDeps({ getAuditLogs });
      const handlers = createAdminAuditHandlers(deps);
      const { req, res } = createReqRes({
        action: 'auth.login',
        conversationId: 'conv-9',
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-02-01T00:00:00.000Z',
      });

      await handlers.listAudit(req, res);

      const [filter] = getAuditLogs.mock.calls[0];
      expect(filter.action).toBe('auth.login');
      expect(filter.conversationId).toBe('conv-9');
      expect(filter.from).toBeInstanceOf(Date);
      expect(filter.to).toBeInstanceOf(Date);
    });

    it('validates actorId and rejects a bad ObjectId', async () => {
      const deps = createDeps();
      const handlers = createAdminAuditHandlers(deps);
      const { req, res, status } = createReqRes({ actorId: 'not-an-id' });

      await handlers.listAudit(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(deps.getAuditLogs).not.toHaveBeenCalled();
    });

    it('forwards a valid actorId filter', async () => {
      const actorId = new Types.ObjectId().toString();
      const getAuditLogs = jest.fn().mockResolvedValue([]);
      const deps = createDeps({ getAuditLogs });
      const handlers = createAdminAuditHandlers(deps);
      const { req, res, status } = createReqRes({ actorId });

      await handlers.listAudit(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(getAuditLogs.mock.calls[0][0].actorId).toBe(actorId);
    });

    it('rejects an invalid date', async () => {
      const deps = createDeps();
      const handlers = createAdminAuditHandlers(deps);
      const { req, res, status } = createReqRes({ from: 'nope' });

      await handlers.listAudit(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(deps.getAuditLogs).not.toHaveBeenCalled();
    });

    it('returns 500 when a dependency throws', async () => {
      const deps = createDeps({
        getAuditLogs: jest.fn().mockRejectedValue(new Error('db down')),
      });
      const handlers = createAdminAuditHandlers(deps);
      const { req, res, status } = createReqRes();

      await handlers.listAudit(req, res);

      expect(status).toHaveBeenCalledWith(500);
    });
  });

  describe('backfillAudit', () => {
    it('sums the transaction + agent backfill counts', async () => {
      const deps = createDeps({
        backfillAuditFromTransactions: jest.fn().mockResolvedValue({ scanned: 12, inserted: 5 }),
        backfillAgentInvokes: jest.fn().mockResolvedValue({ scanned: 8, inserted: 3 }),
      });
      const handlers = createAdminAuditHandlers(deps);
      const { req, res, status, json } = createReqRes();

      await handlers.backfillAudit(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(deps.backfillAuditFromTransactions).toHaveBeenCalledTimes(1);
      expect(deps.backfillAgentInvokes).toHaveBeenCalledTimes(1);
      expect(json.mock.calls[0][0]).toEqual({ scanned: 20, inserted: 8 });
    });

    it('returns 500 when a backfill throws', async () => {
      const deps = createDeps({
        backfillAuditFromTransactions: jest.fn().mockRejectedValue(new Error('boom')),
      });
      const handlers = createAdminAuditHandlers(deps);
      const { req, res, status } = createReqRes();

      await handlers.backfillAudit(req, res);

      expect(status).toHaveBeenCalledWith(500);
    });
  });
});
