import { Types } from 'mongoose';
import type { IUser, IBalance } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import type { AdminBalanceDeps } from './balance';
import { createAdminBalanceHandlers, TOKEN_CREDITS_PER_USD } from './balance';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const validUserId = new Types.ObjectId().toString();

function mockBalance(overrides: Partial<IBalance> = {}): IBalance {
  return {
    user: new Types.ObjectId(validUserId),
    tokenCredits: 5_000_000,
    autoRefillEnabled: false,
    refillIntervalValue: 30,
    refillIntervalUnit: 'days',
    refillAmount: 0,
    lastRefill: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as IBalance;
}

function createReqRes(
  overrides: {
    params?: Record<string, string>;
    body?: Record<string, unknown>;
  } = {},
) {
  const req = {
    params: overrides.params ?? {},
    query: {},
    body: overrides.body ?? {},
    user: { _id: new Types.ObjectId(), role: 'admin' },
  } as unknown as ServerRequest;

  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;

  return { req, res, status, json };
}

function createDeps(overrides: Partial<AdminBalanceDeps> = {}): AdminBalanceDeps {
  return {
    findUser: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(validUserId) } as IUser),
    findBalanceByUser: jest.fn().mockResolvedValue(mockBalance()),
    findBalancesByUsers: jest.fn().mockResolvedValue([]),
    upsertBalanceFields: jest.fn().mockResolvedValue(mockBalance()),
    ...overrides,
  };
}

function createQueryReqRes(query: Record<string, string | string[]>) {
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

describe('createAdminBalanceHandlers', () => {
  describe('getUserBalance', () => {
    it('returns the mapped balance with a USD conversion', async () => {
      const deps = createDeps({
        findBalanceByUser: jest.fn().mockResolvedValue(
          mockBalance({
            tokenCredits: 2_500_000,
            autoRefillEnabled: true,
            refillAmount: 1_000_000,
          }),
        ),
      });
      const handlers = createAdminBalanceHandlers(deps);
      const { req, res, status, json } = createReqRes({ params: { id: validUserId } });

      await handlers.getUserBalance(req, res);

      expect(status).toHaveBeenCalledWith(200);
      const body = json.mock.calls[0][0];
      expect(body.userId).toBe(validUserId);
      expect(body.tokenCredits).toBe(2_500_000);
      expect(body.balanceUsd).toBe(2.5);
      expect(body.autoRefillEnabled).toBe(true);
      expect(body.refillAmount).toBe(1_000_000);
      expect(body.lastRefill).toBe('2026-01-01T00:00:00.000Z');
    });

    it('returns a zeroed default when no balance record exists', async () => {
      const deps = createDeps({ findBalanceByUser: jest.fn().mockResolvedValue(null) });
      const handlers = createAdminBalanceHandlers(deps);
      const { req, res, status, json } = createReqRes({ params: { id: validUserId } });

      await handlers.getUserBalance(req, res);

      expect(status).toHaveBeenCalledWith(200);
      const body = json.mock.calls[0][0];
      expect(body.tokenCredits).toBe(0);
      expect(body.balanceUsd).toBe(0);
      expect(body.autoRefillEnabled).toBe(false);
      expect(body.refillIntervalUnit).toBe('days');
      expect(body.lastRefill).toBeUndefined();
    });

    it('rejects an invalid user id format', async () => {
      const deps = createDeps();
      const handlers = createAdminBalanceHandlers(deps);
      const { req, res, status } = createReqRes({ params: { id: 'not-an-id' } });

      await handlers.getUserBalance(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(deps.findBalanceByUser).not.toHaveBeenCalled();
    });

    it('returns 404 when the user does not exist', async () => {
      const deps = createDeps({ findUser: jest.fn().mockResolvedValue(null) });
      const handlers = createAdminBalanceHandlers(deps);
      const { req, res, status } = createReqRes({ params: { id: validUserId } });

      await handlers.getUserBalance(req, res);

      expect(status).toHaveBeenCalledWith(404);
      expect(deps.findBalanceByUser).not.toHaveBeenCalled();
    });

    it('returns 500 when a dependency throws', async () => {
      const deps = createDeps({
        findBalanceByUser: jest.fn().mockRejectedValue(new Error('db down')),
      });
      const handlers = createAdminBalanceHandlers(deps);
      const { req, res, status } = createReqRes({ params: { id: validUserId } });

      await handlers.getUserBalance(req, res);

      expect(status).toHaveBeenCalledWith(500);
    });
  });

  describe('getUsersBalances', () => {
    it('returns balances for the requested ids in one query, zero-filling missing ones', async () => {
      const idA = new Types.ObjectId().toString();
      const idB = new Types.ObjectId().toString();
      const findBalancesByUsers = jest
        .fn()
        .mockResolvedValue([
          mockBalance({ user: new Types.ObjectId(idA), tokenCredits: 3_000_000 }),
        ]);
      const deps = createDeps({ findBalancesByUsers });
      const handlers = createAdminBalanceHandlers(deps);
      const { req, res, status, json } = createQueryReqRes({ ids: `${idA},${idB}` });

      await handlers.getUsersBalances(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(findBalancesByUsers).toHaveBeenCalledTimes(1);
      expect(findBalancesByUsers).toHaveBeenCalledWith([idA, idB]);
      const { balances } = json.mock.calls[0][0];
      expect(balances).toHaveLength(2);
      expect(balances[0]).toMatchObject({ userId: idA, tokenCredits: 3_000_000, balanceUsd: 3 });
      expect(balances[1]).toMatchObject({ userId: idB, tokenCredits: 0, balanceUsd: 0 });
    });

    it('filters out invalid ids before querying', async () => {
      const idA = new Types.ObjectId().toString();
      const findBalancesByUsers = jest.fn().mockResolvedValue([]);
      const deps = createDeps({ findBalancesByUsers });
      const handlers = createAdminBalanceHandlers(deps);
      const { req, res, status } = createQueryReqRes({ ids: `${idA}, not-an-id ,` });

      await handlers.getUsersBalances(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(findBalancesByUsers).toHaveBeenCalledWith([idA]);
    });

    it('rejects when ids is missing', async () => {
      const deps = createDeps();
      const handlers = createAdminBalanceHandlers(deps);
      const { req, res, status } = createQueryReqRes({});

      await handlers.getUsersBalances(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(deps.findBalancesByUsers).not.toHaveBeenCalled();
    });

    it('rejects when no id is a valid ObjectId', async () => {
      const deps = createDeps();
      const handlers = createAdminBalanceHandlers(deps);
      const { req, res, status } = createQueryReqRes({ ids: 'a,b,c' });

      await handlers.getUsersBalances(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(deps.findBalancesByUsers).not.toHaveBeenCalled();
    });

    it('rejects more than 200 ids', async () => {
      const ids = Array.from({ length: 201 }, () => new Types.ObjectId().toString()).join(',');
      const deps = createDeps();
      const handlers = createAdminBalanceHandlers(deps);
      const { req, res, status } = createQueryReqRes({ ids });

      await handlers.getUsersBalances(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(deps.findBalancesByUsers).not.toHaveBeenCalled();
    });
  });

  describe('setUserBalance', () => {
    it('upserts tokenCredits and returns the updated balance', async () => {
      const updated = mockBalance({ tokenCredits: 10_000_000 });
      const deps = createDeps({ upsertBalanceFields: jest.fn().mockResolvedValue(updated) });
      const handlers = createAdminBalanceHandlers(deps);
      const { req, res, status, json } = createReqRes({
        params: { id: validUserId },
        body: { tokenCredits: 10_000_000 },
      });

      await handlers.setUserBalance(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(deps.upsertBalanceFields).toHaveBeenCalledWith(validUserId, {
        tokenCredits: 10_000_000,
      });
      const body = json.mock.calls[0][0];
      expect(body.tokenCredits).toBe(10_000_000);
      expect(body.balanceUsd).toBe(10);
    });

    it('rounds fractional tokenCredits to an integer', async () => {
      const deps = createDeps();
      const handlers = createAdminBalanceHandlers(deps);
      const { req, res } = createReqRes({
        params: { id: validUserId },
        body: { tokenCredits: 1_234_567.8 },
      });

      await handlers.setUserBalance(req, res);

      expect(deps.upsertBalanceFields).toHaveBeenCalledWith(validUserId, {
        tokenCredits: 1_234_568,
      });
    });

    it('persists auto-refill settings together', async () => {
      const deps = createDeps();
      const handlers = createAdminBalanceHandlers(deps);
      const { req, res, status } = createReqRes({
        params: { id: validUserId },
        body: {
          autoRefillEnabled: true,
          refillAmount: 2_000_000,
          refillIntervalValue: 7,
          refillIntervalUnit: 'days',
        },
      });

      await handlers.setUserBalance(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(deps.upsertBalanceFields).toHaveBeenCalledWith(validUserId, {
        autoRefillEnabled: true,
        refillAmount: 2_000_000,
        refillIntervalValue: 7,
        refillIntervalUnit: 'days',
      });
    });

    it('rejects an invalid user id format', async () => {
      const deps = createDeps();
      const handlers = createAdminBalanceHandlers(deps);
      const { req, res, status } = createReqRes({
        params: { id: 'bad' },
        body: { tokenCredits: 1 },
      });

      await handlers.setUserBalance(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(deps.upsertBalanceFields).not.toHaveBeenCalled();
    });

    it('rejects an empty body', async () => {
      const deps = createDeps();
      const handlers = createAdminBalanceHandlers(deps);
      const { req, res, status, json } = createReqRes({ params: { id: validUserId }, body: {} });

      await handlers.setUserBalance(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(json.mock.calls[0][0].error).toMatch(/no updatable/i);
      expect(deps.upsertBalanceFields).not.toHaveBeenCalled();
    });

    it('rejects a negative tokenCredits value', async () => {
      const deps = createDeps();
      const handlers = createAdminBalanceHandlers(deps);
      const { req, res, status } = createReqRes({
        params: { id: validUserId },
        body: { tokenCredits: -5 },
      });

      await handlers.setUserBalance(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(deps.upsertBalanceFields).not.toHaveBeenCalled();
    });

    it('rejects a non-numeric tokenCredits value', async () => {
      const deps = createDeps();
      const handlers = createAdminBalanceHandlers(deps);
      const { req, res, status } = createReqRes({
        params: { id: validUserId },
        body: { tokenCredits: 'lots' as unknown as number },
      });

      await handlers.setUserBalance(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(deps.upsertBalanceFields).not.toHaveBeenCalled();
    });

    it('rejects a non-positive refill interval', async () => {
      const deps = createDeps();
      const handlers = createAdminBalanceHandlers(deps);
      const { req, res, status } = createReqRes({
        params: { id: validUserId },
        body: { refillIntervalValue: 0 },
      });

      await handlers.setUserBalance(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(deps.upsertBalanceFields).not.toHaveBeenCalled();
    });

    it('rejects an unknown refill interval unit', async () => {
      const deps = createDeps();
      const handlers = createAdminBalanceHandlers(deps);
      const { req, res, status } = createReqRes({
        params: { id: validUserId },
        body: { refillIntervalUnit: 'fortnights' },
      });

      await handlers.setUserBalance(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(deps.upsertBalanceFields).not.toHaveBeenCalled();
    });

    it('rejects a non-boolean autoRefillEnabled value', async () => {
      const deps = createDeps();
      const handlers = createAdminBalanceHandlers(deps);
      const { req, res, status } = createReqRes({
        params: { id: validUserId },
        body: { autoRefillEnabled: 'yes' as unknown as boolean },
      });

      await handlers.setUserBalance(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(deps.upsertBalanceFields).not.toHaveBeenCalled();
    });

    it('does not upsert a balance for a non-existent user', async () => {
      const deps = createDeps({ findUser: jest.fn().mockResolvedValue(null) });
      const handlers = createAdminBalanceHandlers(deps);
      const { req, res, status } = createReqRes({
        params: { id: validUserId },
        body: { tokenCredits: 1_000_000 },
      });

      await handlers.setUserBalance(req, res);

      expect(status).toHaveBeenCalledWith(404);
      expect(deps.upsertBalanceFields).not.toHaveBeenCalled();
    });
  });

  it('exposes the USD conversion constant', () => {
    expect(TOKEN_CREDITS_PER_USD).toBe(1_000_000);
  });
});
