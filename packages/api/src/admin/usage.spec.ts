import { Types } from 'mongoose';
import type { CreditSpendByUser, UserUsageAggregate } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import type { AdminUsageDeps } from './usage';
import { createAdminUsageHandlers } from './usage';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

function aggregate(overrides: Partial<UserUsageAggregate> = {}): UserUsageAggregate {
  return {
    userId: new Types.ObjectId().toString(),
    email: 'user@example.com',
    name: 'User',
    totalTokens: 1_000,
    totalCredits: 2_000_000,
    ...overrides,
  };
}

function ledger(overrides: Partial<CreditSpendByUser> = {}): CreditSpendByUser {
  return {
    rows: [],
    unattributedMicroUsd: 0,
    unattributedRequests: 0,
    ...overrides,
  };
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

function createDeps(overrides: Partial<AdminUsageDeps> = {}): AdminUsageDeps {
  return {
    aggregateUsageByUser: jest.fn().mockResolvedValue([]),
    aggregateCreditSpendByUser: jest.fn().mockResolvedValue(ledger()),
    ...overrides,
  };
}

describe('createAdminUsageHandlers', () => {
  describe('getUsage', () => {
    it('reports the ledger cost as money and the journal only as tokens', async () => {
      const userId = new Types.ObjectId().toString();
      /** The token journal prices this user at $2.50 via the built-in rate table;
       *  the ledger says OpenRouter actually charged $5.00 for the same window. */
      const aggregateUsageByUser = jest
        .fn()
        .mockResolvedValue([aggregate({ userId, totalCredits: 2_500_000, totalTokens: 1_234 })]);
      const aggregateCreditSpendByUser = jest.fn().mockResolvedValue(
        ledger({
          rows: [
            {
              userId,
              email: 'user@example.com',
              name: 'User',
              microUsd: 5_000_000,
              requests: 7,
            },
          ],
        }),
      );
      const handlers = createAdminUsageHandlers(
        createDeps({ aggregateUsageByUser, aggregateCreditSpendByUser }),
      );
      const { req, res, status, json } = createReqRes({
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-02-01T00:00:00.000Z',
      });

      await handlers.getUsage(req, res);

      expect(status).toHaveBeenCalledWith(200);
      const body = json.mock.calls[0][0];
      expect(body.from).toBe('2026-01-01T00:00:00.000Z');
      expect(body.to).toBe('2026-02-01T00:00:00.000Z');
      expect(body.rows).toHaveLength(1);
      expect(body.rows[0]).toMatchObject({
        userId,
        totalCredits: 5_000_000,
        totalUsd: 5,
        totalTokens: 1_234,
      });
    });

    it('reports spend the ledger could not attribute instead of dropping it', async () => {
      const aggregateCreditSpendByUser = jest.fn().mockResolvedValue(
        ledger({
          rows: [{ userId: new Types.ObjectId().toString(), microUsd: 1_000_000, requests: 2 }],
          unattributedMicroUsd: 3_000_000,
          unattributedRequests: 208,
        }),
      );
      const handlers = createAdminUsageHandlers(createDeps({ aggregateCreditSpendByUser }));
      const { req, res, status, json } = createReqRes({});

      await handlers.getUsage(req, res);

      expect(status).toHaveBeenCalledWith(200);
      const body = json.mock.calls[0][0];
      expect(body.unattributedCredits).toBe(3_000_000);
      expect(body.unattributedUsd).toBe(3);
      expect(body.unattributedRequests).toBe(208);
    });

    it('keeps a user the ledger has no rows for, at zero money', async () => {
      const userId = new Types.ObjectId().toString();
      const aggregateUsageByUser = jest
        .fn()
        .mockResolvedValue([aggregate({ userId, totalTokens: 500, totalCredits: 900_000 })]);
      const handlers = createAdminUsageHandlers(createDeps({ aggregateUsageByUser }));
      const { req, res, status, json } = createReqRes({});

      await handlers.getUsage(req, res);

      expect(status).toHaveBeenCalledWith(200);
      const body = json.mock.calls[0][0];
      expect(body.rows).toHaveLength(1);
      expect(body.rows[0]).toMatchObject({
        userId,
        totalTokens: 500,
        totalCredits: 0,
        totalUsd: 0,
      });
    });

    it('sorts rows by actual spend, not by tokens', async () => {
      const spender = new Types.ObjectId().toString();
      const chatterbox = new Types.ObjectId().toString();
      const aggregateUsageByUser = jest
        .fn()
        .mockResolvedValue([
          aggregate({ userId: chatterbox, totalTokens: 1_000_000 }),
          aggregate({ userId: spender, totalTokens: 10 }),
        ]);
      const aggregateCreditSpendByUser = jest.fn().mockResolvedValue(
        ledger({
          rows: [
            { userId: chatterbox, microUsd: 10, requests: 900 },
            { userId: spender, microUsd: 9_000_000, requests: 3 },
          ],
        }),
      );
      const handlers = createAdminUsageHandlers(
        createDeps({ aggregateUsageByUser, aggregateCreditSpendByUser }),
      );
      const { req, res, json } = createReqRes({});

      await handlers.getUsage(req, res);

      const body = json.mock.calls[0][0];
      expect(body.rows.map((row: { userId: string }) => row.userId)).toEqual([spender, chatterbox]);
    });

    it('defaults to a 30-day window ending now when no dates are given', async () => {
      const deps = createDeps();
      const handlers = createAdminUsageHandlers(deps);
      const { req, res, status, json } = createReqRes({});

      await handlers.getUsage(req, res);

      expect(status).toHaveBeenCalledWith(200);
      const { start, end } = (deps.aggregateCreditSpendByUser as jest.Mock).mock.calls[0][0];
      const spanDays = (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
      expect(Math.round(spanDays)).toBe(30);
      const body = json.mock.calls[0][0];
      expect(body.rows).toEqual([]);
    });

    it('queries both sources over the same window', async () => {
      const deps = createDeps();
      const handlers = createAdminUsageHandlers(deps);
      const { req, res } = createReqRes({
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-02-01T00:00:00.000Z',
      });

      await handlers.getUsage(req, res);

      const ledgerWindow = (deps.aggregateCreditSpendByUser as jest.Mock).mock.calls[0][0];
      const journalWindow = (deps.aggregateUsageByUser as jest.Mock).mock.calls[0][0];
      expect(ledgerWindow.start.toISOString()).toBe('2026-01-01T00:00:00.000Z');
      expect(ledgerWindow.end.toISOString()).toBe('2026-02-01T00:00:00.000Z');
      expect(journalWindow.start.getTime()).toBe(ledgerWindow.start.getTime());
      expect(journalWindow.end.getTime()).toBe(ledgerWindow.end.getTime());
    });

    it('rejects an invalid "from" date', async () => {
      const deps = createDeps();
      const handlers = createAdminUsageHandlers(deps);
      const { req, res, status } = createReqRes({ from: 'nonsense' });

      await handlers.getUsage(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(deps.aggregateCreditSpendByUser).not.toHaveBeenCalled();
    });

    it('rejects when from is not before to', async () => {
      const deps = createDeps();
      const handlers = createAdminUsageHandlers(deps);
      const { req, res, status } = createReqRes({
        from: '2026-02-01T00:00:00.000Z',
        to: '2026-01-01T00:00:00.000Z',
      });

      await handlers.getUsage(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(deps.aggregateCreditSpendByUser).not.toHaveBeenCalled();
    });

    it('rejects a window larger than the cap', async () => {
      const deps = createDeps();
      const handlers = createAdminUsageHandlers(deps);
      const { req, res, status } = createReqRes({
        from: '2020-01-01T00:00:00.000Z',
        to: '2026-01-01T00:00:00.000Z',
      });

      await handlers.getUsage(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(deps.aggregateCreditSpendByUser).not.toHaveBeenCalled();
    });

    it('returns 500 when the ledger aggregation throws', async () => {
      const deps = createDeps({
        aggregateCreditSpendByUser: jest.fn().mockRejectedValue(new Error('db down')),
      });
      const handlers = createAdminUsageHandlers(deps);
      const { req, res, status } = createReqRes({});

      await handlers.getUsage(req, res);

      expect(status).toHaveBeenCalledWith(500);
    });

    it('returns 500 when the token aggregation throws', async () => {
      const deps = createDeps({
        aggregateUsageByUser: jest.fn().mockRejectedValue(new Error('db down')),
      });
      const handlers = createAdminUsageHandlers(deps);
      const { req, res, status } = createReqRes({});

      await handlers.getUsage(req, res);

      expect(status).toHaveBeenCalledWith(500);
    });
  });
});
