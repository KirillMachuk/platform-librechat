import { Types } from 'mongoose';
import type { UserUsageAggregate } from '@librechat/data-schemas';
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
    ...overrides,
  };
}

describe('createAdminUsageHandlers', () => {
  describe('getUsage', () => {
    it('maps aggregates to rows with a USD conversion', async () => {
      const aggregateUsageByUser = jest
        .fn()
        .mockResolvedValue([aggregate({ totalCredits: 2_500_000, totalTokens: 1_234 })]);
      const deps = createDeps({ aggregateUsageByUser });
      const handlers = createAdminUsageHandlers(deps);
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
        totalCredits: 2_500_000,
        totalTokens: 1_234,
        totalUsd: 2.5,
      });
    });

    it('defaults to a 30-day window ending now when no dates are given', async () => {
      const aggregateUsageByUser = jest.fn().mockResolvedValue([]);
      const deps = createDeps({ aggregateUsageByUser });
      const handlers = createAdminUsageHandlers(deps);
      const { req, res, status, json } = createReqRes({});

      await handlers.getUsage(req, res);

      expect(status).toHaveBeenCalledWith(200);
      const { start, end } = aggregateUsageByUser.mock.calls[0][0];
      const spanDays = (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
      expect(Math.round(spanDays)).toBe(30);
      const body = json.mock.calls[0][0];
      expect(body.rows).toEqual([]);
    });

    it('rejects an invalid "from" date', async () => {
      const deps = createDeps();
      const handlers = createAdminUsageHandlers(deps);
      const { req, res, status } = createReqRes({ from: 'nonsense' });

      await handlers.getUsage(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(deps.aggregateUsageByUser).not.toHaveBeenCalled();
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
      expect(deps.aggregateUsageByUser).not.toHaveBeenCalled();
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
      expect(deps.aggregateUsageByUser).not.toHaveBeenCalled();
    });

    it('returns 500 when the aggregation throws', async () => {
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
