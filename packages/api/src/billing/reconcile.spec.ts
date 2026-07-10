import type { CreditBillingStatus } from '@librechat/data-schemas';
import type { OpenRouterManagement } from './openrouter';
import type { BillingReconcilerDeps } from './reconcile';
import { createBillingReconciler } from './reconcile';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

function statusOf(spentMicroUsd: number): CreditBillingStatus {
  return {
    month: '2026-07',
    poolMicroUsd: 250_000_000,
    spentMicroUsd,
    requestCount: 1,
    purchasedMicroUsd: 0,
    packageSpentMicroUsd: 0,
    packageRemainingMicroUsd: 0,
    blocked: false,
    notified80At: null,
    notifiedExhaustedAt: null,
  };
}

function openrouterOf(usageMonthlyUsd: number | null, configured = true): OpenRouterManagement {
  return {
    isConfigured: configured,
    getKey: jest.fn().mockResolvedValue({
      limitUsd: 300,
      usageUsd: 500,
      usageMonthlyUsd,
      disabled: false,
      raw: {},
    }),
    updateLimit: jest.fn(),
  };
}

function createDeps(overrides: Partial<BillingReconcilerDeps> = {}): BillingReconcilerDeps {
  return {
    openrouter: openrouterOf(100),
    getCreditBillingStatus: jest.fn().mockResolvedValue(statusOf(100_000_000)), // $100
    poolMicroUsd: 250_000_000,
    sendAlert: jest.fn().mockResolvedValue(undefined),
    recordAudit: jest.fn(),
    ...overrides,
  };
}

describe('createBillingReconciler', () => {
  it('reports unconfigured when the management key is absent', async () => {
    const deps = createDeps({ openrouter: openrouterOf(100, false) });
    const report = await createBillingReconciler(deps).run();
    expect(report.configured).toBe(false);
    expect(deps.sendAlert).not.toHaveBeenCalled();
  });

  it('stays quiet within the 3% tolerance', async () => {
    // Ledger $100 vs OpenRouter $102 → 1.96% — no alert.
    const deps = createDeps({ openrouter: openrouterOf(102) });
    const report = await createBillingReconciler(deps).run();
    expect(report.alerted).toBe(false);
    expect(report.diffPercent).toBeCloseTo(2.0, 0);
    expect(deps.sendAlert).not.toHaveBeenCalled();
  });

  it('alerts when drift exceeds 3% and $1', async () => {
    // Ledger $100 vs OpenRouter $110 → ~9%.
    const deps = createDeps({ openrouter: openrouterOf(110) });
    const report = await createBillingReconciler(deps).run();
    expect(report.alerted).toBe(true);
    expect(deps.sendAlert).toHaveBeenCalledWith(expect.objectContaining({ kind: 'reconcile' }));
    expect(deps.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'billing.reconcile_alert' }),
    );
  });

  it('ignores large percentages on tiny absolute amounts (early month noise)', async () => {
    // Ledger $0.50 vs OpenRouter $0.10 → 80% but only $0.40 apart.
    const deps = createDeps({
      getCreditBillingStatus: jest.fn().mockResolvedValue(statusOf(500_000)),
      openrouter: openrouterOf(0.1),
    });
    const report = await createBillingReconciler(deps).run();
    expect(report.alerted).toBe(false);
    expect(deps.sendAlert).not.toHaveBeenCalled();
  });

  it('handles a missing usage_monthly field gracefully', async () => {
    const deps = createDeps({ openrouter: openrouterOf(null) });
    const report = await createBillingReconciler(deps).run();
    expect(report.alerted).toBe(false);
    expect(report.diffPercent).toBeNull();
    expect(report.reason).toMatch(/usage_monthly/);
  });

  it('never throws when OpenRouter errors', async () => {
    const openrouter: OpenRouterManagement = {
      isConfigured: true,
      getKey: jest.fn().mockRejectedValue(new Error('502')),
      updateLimit: jest.fn(),
    };
    const deps = createDeps({ openrouter });
    const report = await createBillingReconciler(deps).run();
    expect(report.configured).toBe(true);
    expect(report.alerted).toBe(false);
    expect(report.reason).toBeDefined();
  });
});
