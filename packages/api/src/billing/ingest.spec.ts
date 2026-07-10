import type { RecordCreditSpendResult } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import type { BillingIngestDeps } from './ingest';
import { createBillingIngestHandlers } from './ingest';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const POOL = 250_000_000; // 25 000 credits in µ$

function spendResult(overrides: Partial<RecordCreditSpendResult> = {}): RecordCreditSpendResult {
  return {
    duplicate: false,
    month: '2026-07',
    poolMicroUsd: POOL,
    spentBeforeMicroUsd: 0,
    spentAfterMicroUsd: 12_340,
    crossed80: false,
    crossedPool: false,
    notified80At: null,
    notifiedExhaustedAt: null,
    ...overrides,
  };
}

function createReqRes(body: Record<string, unknown> = {}) {
  const req = { params: {}, query: {}, body } as unknown as ServerRequest;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  return { req, res, status, json };
}

function createDeps(overrides: Partial<BillingIngestDeps> = {}): BillingIngestDeps {
  return {
    recordCreditSpend: jest.fn().mockResolvedValue(spendResult()),
    getCreditBillingStatus: jest.fn().mockResolvedValue({
      month: '2026-07',
      poolMicroUsd: POOL,
      spentMicroUsd: 0,
      requestCount: 0,
      purchasedMicroUsd: 0,
      packageSpentMicroUsd: 0,
      packageRemainingMicroUsd: 0,
      blocked: false,
    }),
    poolMicroUsd: POOL,
    ...overrides,
  };
}

describe('createBillingIngestHandlers', () => {
  describe('postSpend', () => {
    it('converts costUsd to rounded micro-USD and passes the pool snapshot', async () => {
      const deps = createDeps();
      const handlers = createBillingIngestHandlers(deps);
      const { req, res, status } = createReqRes({
        costUsd: 0.0123456,
        model: 'anthropic/claude-sonnet-4.6',
        sourceId: 'gen-1',
      });

      await handlers.postSpend(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(deps.recordCreditSpend).toHaveBeenCalledWith(
        expect.objectContaining({
          microUsd: 12_346, // 0.0123456 * 1e6 rounded
          poolMicroUsd: POOL,
          model: 'anthropic/claude-sonnet-4.6',
          sourceId: 'gen-1',
        }),
      );
    });

    it('accepts zero-cost requests (cached/free) without error', async () => {
      const deps = createDeps();
      const handlers = createBillingIngestHandlers(deps);
      const { req, res, status } = createReqRes({ costUsd: 0 });

      await handlers.postSpend(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(deps.recordCreditSpend).toHaveBeenCalledWith(expect.objectContaining({ microUsd: 0 }));
    });

    it.each([
      ['missing', {}],
      ['non-number', { costUsd: '0.5' }],
      ['negative', { costUsd: -1 }],
      ['NaN', { costUsd: Number.NaN }],
      ['absurd', { costUsd: 100_000 }],
    ])('rejects %s costUsd with 400', async (_label, body) => {
      const deps = createDeps();
      const handlers = createBillingIngestHandlers(deps);
      const { req, res, status } = createReqRes(body);

      await handlers.postSpend(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(deps.recordCreditSpend).not.toHaveBeenCalled();
    });

    it('drops an invalid userId instead of failing the report', async () => {
      const deps = createDeps();
      const handlers = createBillingIngestHandlers(deps);
      const { req, res, status } = createReqRes({ costUsd: 0.01, userId: 'not-an-objectid' });

      await handlers.postSpend(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(deps.recordCreditSpend).toHaveBeenCalledWith(
        expect.objectContaining({ userId: undefined }),
      );
    });

    it('fires onSpendRecorded and survives a throwing hook', async () => {
      const onSpendRecorded = jest.fn(() => {
        throw new Error('boom');
      });
      const deps = createDeps({ onSpendRecorded });
      const handlers = createBillingIngestHandlers(deps);
      const { req, res, status } = createReqRes({ costUsd: 0.5 });

      await handlers.postSpend(req, res);

      expect(onSpendRecorded).toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(200);
    });

    it('reports duplicate=true on a deduped retry', async () => {
      const deps = createDeps({
        recordCreditSpend: jest.fn().mockResolvedValue(spendResult({ duplicate: true })),
      });
      const handlers = createBillingIngestHandlers(deps);
      const { req, res, json } = createReqRes({ costUsd: 0.5, sourceId: 'gen-1' });

      await handlers.postSpend(req, res);

      expect(json.mock.calls[0][0]).toMatchObject({ ok: true, duplicate: true });
    });

    it('returns 500 when the ledger write fails', async () => {
      const deps = createDeps({
        recordCreditSpend: jest.fn().mockRejectedValue(new Error('db down')),
      });
      const handlers = createBillingIngestHandlers(deps);
      const { req, res, status } = createReqRes({ costUsd: 0.5 });

      await handlers.postSpend(req, res);

      expect(status).toHaveBeenCalledWith(500);
    });
  });

  describe('getStatus', () => {
    it('returns the gate fields', async () => {
      const deps = createDeps({
        getCreditBillingStatus: jest.fn().mockResolvedValue({
          month: '2026-07',
          poolMicroUsd: POOL,
          spentMicroUsd: POOL + 5,
          requestCount: 10,
          purchasedMicroUsd: 0,
          packageSpentMicroUsd: 5,
          packageRemainingMicroUsd: -5,
          blocked: true,
        }),
      });
      const handlers = createBillingIngestHandlers(deps);
      const { req, res, json } = createReqRes();

      await handlers.getStatus(req, res);

      expect(json.mock.calls[0][0]).toMatchObject({
        blocked: true,
        month: '2026-07',
        poolMicroUsd: POOL,
      });
    });
  });
});
