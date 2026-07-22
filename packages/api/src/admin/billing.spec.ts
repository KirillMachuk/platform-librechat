import { Types } from 'mongoose';
import type {
  AddCreditPackageResult,
  CreditBillingStatus,
  CreditPackageWithRemaining,
} from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import type { AdminBillingDeps } from './billing';
import { createAdminBillingHandlers } from './billing';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const POOL = 250_000_000; // 25 000 Credits

function statusOf(overrides: Partial<CreditBillingStatus> = {}): CreditBillingStatus {
  return {
    month: '2026-07',
    poolMicroUsd: POOL,
    spentMicroUsd: 0,
    requestCount: 0,
    purchasedMicroUsd: 0,
    packageSpentMicroUsd: 0,
    packageRemainingMicroUsd: 0,
    blocked: false,
    notified80At: null,
    notifiedExhaustedAt: null,
    ...overrides,
  };
}

function lotOf(overrides: Partial<CreditPackageWithRemaining> = {}): CreditPackageWithRemaining {
  return {
    id: new Types.ObjectId().toString(),
    kind: 'package',
    credits: 5_000,
    microUsd: 50_000_000,
    remainingMicroUsd: 50_000_000,
    comment: 'Счёт №7',
    addedByEmail: 'op@1ma.ai',
    createdAt: new Date('2026-07-01T10:00:00Z'),
    ...overrides,
  };
}

/** A key mock: current fuse and what it has already burned this UTC month. */
function keyOf(limitUsd: number | null, usageMonthlyUsd: number | null) {
  return jest.fn().mockResolvedValue({
    limitUsd,
    usageUsd: usageMonthlyUsd,
    usageMonthlyUsd,
    disabled: false,
    raw: {},
  });
}

function createReqRes(params: { email?: string; body?: Record<string, unknown> } = {}) {
  const req = {
    params: {},
    query: {},
    body: params.body ?? {},
    user: { _id: new Types.ObjectId(), role: 'ADMIN', email: params.email ?? 'client@corp.by' },
    headers: {},
    ip: '10.0.0.1',
  } as unknown as ServerRequest;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  return { req, res, status, json };
}

function createDeps(overrides: Partial<AdminBillingDeps> = {}): AdminBillingDeps {
  const addResult: AddCreditPackageResult = {
    created: true,
    package: { _id: new Types.ObjectId() } as AddCreditPackageResult['package'],
  };
  return {
    getCreditBillingStatus: jest.fn().mockResolvedValue(statusOf()),
    listCreditPackages: jest
      .fn()
      .mockResolvedValue({ packages: [] as CreditPackageWithRemaining[], packageSpentMicroUsd: 0 }),
    addCreditPackage: jest.fn().mockResolvedValue(addResult),
    poolMicroUsd: POOL,
    metering: true,
    operatorEmails: ['op@1ma.ai'],
    limitHeadroom: 0.1,
    recordAudit: jest.fn(),
    ...overrides,
  };
}

describe('createAdminBillingHandlers', () => {
  describe('getSummary', () => {
    it('returns Credits-only display math (no $ fields anywhere)', async () => {
      const deps = createDeps({
        getCreditBillingStatus: jest.fn().mockResolvedValue(
          statusOf({
            spentMicroUsd: 201_234_567, // ≈ 20 123 credits
            purchasedMicroUsd: 100_000_000,
            packageSpentMicroUsd: 0,
            packageRemainingMicroUsd: 100_000_000,
          }),
        ),
        listCreditPackages: jest.fn().mockResolvedValue({
          packages: [lotOf({ credits: 10_000, microUsd: 100_000_000 })],
          packageSpentMicroUsd: 0,
        }),
      });
      const handlers = createAdminBillingHandlers(deps);
      const { req, res, json } = createReqRes();

      await handlers.getSummary(req, res);

      const body = json.mock.calls[0][0];
      expect(body).toMatchObject({
        month: '2026-07',
        poolCredits: 25_000,
        spentCredits: 20_123,
        poolRemainingCredits: 4_877,
        percentUsed: 80,
        warn80: true,
        blocked: false,
        packagePurchasedCredits: 10_000,
        packageRemainingCredits: 10_000,
        isOperator: false,
        metering: true,
      });
      // Display invariant: остаток + израсходовано = пул.
      expect(body.spentCredits + body.poolRemainingCredits).toBe(body.poolCredits);
      expect(JSON.stringify(body)).not.toMatch(/[Uu]sd|\$/);
    });

    it('reports metering=false when spend metering is not wired', async () => {
      const deps = createDeps({ metering: false });
      const handlers = createAdminBillingHandlers(deps);
      const { req, res, json } = createReqRes();

      await handlers.getSummary(req, res);

      expect(json.mock.calls[0][0].metering).toBe(false);
    });

    it('marks operators by allowlisted email, case-insensitively', async () => {
      const deps = createDeps();
      const handlers = createAdminBillingHandlers(deps);
      const { req, res, json } = createReqRes({ email: 'OP@1MA.AI' });

      await handlers.getSummary(req, res);

      expect(json.mock.calls[0][0].isOperator).toBe(true);
    });
  });

  describe('addPackage', () => {
    const validBody = { credits: 5_000, comment: 'Счёт №42', idempotencyKey: 'uuid-1' };

    it('rejects non-operators with 403 and touches nothing', async () => {
      const deps = createDeps();
      const handlers = createAdminBillingHandlers(deps);
      const { req, res, status } = createReqRes({ email: 'client@corp.by', body: validBody });

      await handlers.addPackage(req, res);

      expect(status).toHaveBeenCalledWith(403);
      expect(deps.addCreditPackage).not.toHaveBeenCalled();
      expect(deps.recordAudit).not.toHaveBeenCalled();
    });

    it.each([[4_000], ['5000'], [undefined], [0]])(
      'rejects invalid package size %p',
      async (credits) => {
        const deps = createDeps();
        const handlers = createAdminBillingHandlers(deps);
        const { req, res, status } = createReqRes({
          email: 'op@1ma.ai',
          body: { credits, idempotencyKey: 'k' },
        });

        await handlers.addPackage(req, res);

        expect(status).toHaveBeenCalledWith(400);
        expect(deps.addCreditPackage).not.toHaveBeenCalled();
      },
    );

    it('accepts a negative adjustment and audits it as an adjustment', async () => {
      const deps = createDeps();
      const handlers = createAdminBillingHandlers(deps);
      const { req, res, status } = createReqRes({
        email: 'op@1ma.ai',
        body: {
          kind: 'adjustment',
          credits: -1_500,
          comment: 'откат ошибочного начисления',
          idempotencyKey: 'adj-1',
        },
      });

      await handlers.addPackage(req, res);

      expect(status).toHaveBeenCalledWith(201);
      expect(deps.addCreditPackage).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'adjustment', credits: -1_500 }),
      );
      expect(deps.recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'billing.adjustment_added' }),
      );
    });

    it('accepts an off-contract positive adjustment (bank transfer the service never sees)', async () => {
      const deps = createDeps();
      const handlers = createAdminBillingHandlers(deps);
      const { req, res, status } = createReqRes({
        email: 'op@1ma.ai',
        body: {
          kind: 'adjustment',
          credits: 7_500,
          comment: 'оплата п/п №15',
          idempotencyKey: 'adj-2',
        },
      });

      await handlers.addPackage(req, res);

      expect(status).toHaveBeenCalledWith(201);
      expect(deps.addCreditPackage).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'adjustment', credits: 7_500 }),
      );
    });

    it('does not tighten the key limit below the money already spent (clawback path)', async () => {
      /* A negative adjustment lowers the computed limit. Writing it while the key has
       * already burned more than that would cut every model instantly — the outage the
       * fuse exists to prevent, now reachable from the admin screen. */
      const updateLimit = jest.fn().mockResolvedValue(undefined);
      const deps = createDeps({
        getCreditBillingStatus: jest.fn().mockResolvedValue(statusOf()),
        openrouter: { isConfigured: true, getKey: keyOf(605, 400), updateLimit },
      });
      const handlers = createAdminBillingHandlers(deps);
      const { req, res, json } = createReqRes({
        email: 'op@1ma.ai',
        body: {
          kind: 'adjustment',
          credits: -5_000,
          comment: 'откат',
          idempotencyKey: 'adj-cut',
        },
      });

      await handlers.addPackage(req, res);

      expect(updateLimit).not.toHaveBeenCalled();
      expect(json.mock.calls[0][0].limitUpdate).toMatchObject({ mode: 'unchanged' });
    });

    it('withholds an adjustment comment from a client admin, keeps it for the operator', async () => {
      const lots = {
        packages: [
          lotOf({ kind: 'adjustment', credits: -1_000, comment: 'возврат за перерасход ключа' }),
          lotOf({ kind: 'package', comment: 'Счёт №7' }),
        ],
        packageSpentMicroUsd: 0,
      };
      const handlers = createAdminBillingHandlers(
        createDeps({
          listCreditPackages: jest.fn().mockResolvedValue(lots),
        }),
      );

      const client = createReqRes({ email: 'client@corp.by' });
      await handlers.getSummary(client.req, client.res);
      const clientLots = client.json.mock.calls[0][0].lots;
      expect(clientLots[0].comment).toBeUndefined();
      expect(clientLots[1].comment).toBe('Счёт №7');

      const operator = createReqRes({ email: 'op@1ma.ai' });
      await handlers.getSummary(operator.req, operator.res);
      expect(operator.json.mock.calls[0][0].lots[0].comment).toBe('возврат за перерасход ключа');
    });

    it('requires a comment on an adjustment (its only paper trail)', async () => {
      const deps = createDeps();
      const handlers = createAdminBillingHandlers(deps);
      const { req, res, status } = createReqRes({
        email: 'op@1ma.ai',
        body: { kind: 'adjustment', credits: 100, idempotencyKey: 'adj-3' },
      });

      await handlers.addPackage(req, res);

      expect(status).toHaveBeenCalledWith(400);
      expect(deps.addCreditPackage).not.toHaveBeenCalled();
    });

    it.each([[0], [1.5], [60_000], [-60_000]])(
      'rejects out-of-range adjustment %p',
      async (credits) => {
        const deps = createDeps();
        const handlers = createAdminBillingHandlers(deps);
        const { req, res, status } = createReqRes({
          email: 'op@1ma.ai',
          body: { kind: 'adjustment', credits, comment: 'c', idempotencyKey: 'adj-4' },
        });

        await handlers.addPackage(req, res);

        expect(status).toHaveBeenCalledWith(400);
        expect(deps.addCreditPackage).not.toHaveBeenCalled();
      },
    );

    it('requires an idempotencyKey', async () => {
      const deps = createDeps();
      const handlers = createAdminBillingHandlers(deps);
      const { req, res, status } = createReqRes({
        email: 'op@1ma.ai',
        body: { credits: 5_000 },
      });

      await handlers.addPackage(req, res);

      expect(status).toHaveBeenCalledWith(400);
    });

    it('adds the lot, audits billing.package_added and reports manual limit mode', async () => {
      const deps = createDeps({
        getCreditBillingStatus: jest
          .fn()
          .mockResolvedValue(statusOf({ packageRemainingMicroUsd: 50_000_000 })),
      });
      const handlers = createAdminBillingHandlers(deps);
      const { req, res, status, json } = createReqRes({ email: 'op@1ma.ai', body: validBody });

      await handlers.addPackage(req, res);

      expect(status).toHaveBeenCalledWith(201);
      expect(deps.addCreditPackage).toHaveBeenCalledWith(
        expect.objectContaining({
          credits: 5_000,
          idempotencyKey: 'uuid-1',
          addedByEmail: 'op@1ma.ai',
        }),
      );
      expect(deps.recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'billing.package_added',
          metadata: expect.objectContaining({ credits: 5_000, comment: 'Счёт №42' }),
        }),
      );
      const body = json.mock.calls[0][0];
      // allowed = $250 pool + $50 packages → ×1.1 = $330.
      expect(body.limitUpdate).toMatchObject({ mode: 'manual', recommendedLimitUsd: 330 });
    });

    it('updates the OpenRouter limit automatically when management API is configured', async () => {
      const updateLimit = jest.fn().mockResolvedValue(undefined);
      const deps = createDeps({
        getCreditBillingStatus: jest
          .fn()
          .mockResolvedValue(statusOf({ packageRemainingMicroUsd: 50_000_000 })),
        openrouter: { isConfigured: true, getKey: keyOf(100, 10), updateLimit },
      });
      const handlers = createAdminBillingHandlers(deps);
      const { req, res, json } = createReqRes({ email: 'op@1ma.ai', body: validBody });

      await handlers.addPackage(req, res);

      expect(updateLimit).toHaveBeenCalledWith(330);
      expect(json.mock.calls[0][0].limitUpdate).toMatchObject({ mode: 'auto', limitUsd: 330 });
      expect(deps.recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'billing.limit_updated' }),
      );
    });

    it('falls back to manual mode when the limit PATCH fails', async () => {
      const deps = createDeps({
        openrouter: {
          isConfigured: true,
          getKey: jest.fn(),
          updateLimit: jest.fn().mockRejectedValue(new Error('502')),
        },
      });
      const handlers = createAdminBillingHandlers(deps);
      const { req, res, status, json } = createReqRes({ email: 'op@1ma.ai', body: validBody });

      await handlers.addPackage(req, res);

      expect(status).toHaveBeenCalledWith(201);
      expect(json.mock.calls[0][0].limitUpdate.mode).toBe('manual');
    });

    it('treats an idempotency replay as success without re-auditing or re-syncing the limit', async () => {
      const deps = createDeps({
        addCreditPackage: jest.fn().mockResolvedValue({
          created: false,
          package: { _id: new Types.ObjectId() },
        } as AddCreditPackageResult),
        openrouter: { isConfigured: true, getKey: jest.fn(), updateLimit: jest.fn() },
      });
      const handlers = createAdminBillingHandlers(deps);
      const { req, res, status, json } = createReqRes({ email: 'op@1ma.ai', body: validBody });

      await handlers.addPackage(req, res);

      expect(status).toHaveBeenCalledWith(200);
      expect(json.mock.calls[0][0].created).toBe(false);
      expect(deps.recordAudit).not.toHaveBeenCalled();
      expect(deps.openrouter?.updateLimit).not.toHaveBeenCalled();
    });
  });

  describe('reconcile', () => {
    it('is operator-only', async () => {
      const deps = createDeps({ reconciler: { run: jest.fn() } });
      const handlers = createAdminBillingHandlers(deps);
      const { req, res, status } = createReqRes({ email: 'client@corp.by' });

      await handlers.reconcile(req, res);

      expect(status).toHaveBeenCalledWith(403);
      expect(deps.reconciler?.run).not.toHaveBeenCalled();
    });

    it('runs the reconciler for operators', async () => {
      const run = jest.fn().mockResolvedValue({ configured: true, alerted: false });
      const deps = createDeps({ reconciler: { run } });
      const handlers = createAdminBillingHandlers(deps);
      const { req, res, json } = createReqRes({ email: 'op@1ma.ai' });

      await handlers.reconcile(req, res);

      expect(run).toHaveBeenCalled();
      expect(json.mock.calls[0][0]).toMatchObject({ configured: true });
    });

    it('reports unconfigured when no reconciler is wired', async () => {
      const deps = createDeps();
      const handlers = createAdminBillingHandlers(deps);
      const { req, res, json } = createReqRes({ email: 'op@1ma.ai' });

      await handlers.reconcile(req, res);

      expect(json.mock.calls[0][0]).toMatchObject({ configured: false });
    });
  });
});
