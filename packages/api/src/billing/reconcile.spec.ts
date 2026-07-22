import { logger } from '@librechat/data-schemas';
import type { CreditBillingStatus } from '@librechat/data-schemas';
import type { OpenRouterManagement } from './openrouter';
import type { BillingReconcilerDeps } from './reconcile';
import { createBillingReconciler } from './reconcile';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

/** Fixed mid-month timestamp — well past the UTC boundary window, so the
 *  early-month skip never fires and these tests stay deterministic. */
const NOW = new Date('2026-07-15T12:00:00Z');

function statusOf(spentMicroUsd: number): CreditBillingStatus {
  return {
    month: '2026-07-01',
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

function openrouterOf(
  usageMonthlyUsd: number | null,
  configured = true,
  limitUsd: number | null = 300,
): OpenRouterManagement {
  return {
    isConfigured: configured,
    getKey: jest.fn().mockResolvedValue({
      limitUsd,
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
    // Period journal matches the period counter by default (no internal drift).
    sumCreditSpendJournal: jest.fn().mockResolvedValue({ microUsd: 100_000_000, count: 1 }),
    // UTC-month journal = the external ledger figure compared to OpenRouter usage_monthly.
    sumCreditSpendJournalRange: jest.fn().mockResolvedValue({ microUsd: 100_000_000, count: 1 }),
    /** Metering has been running since well before this UTC month → honest comparison. */
    getFirstCreditSpendAt: jest.fn().mockResolvedValue(new Date('2026-05-01T00:00:00Z')),
    poolMicroUsd: 250_000_000,
    sendAlert: jest.fn().mockResolvedValue(undefined),
    recordAudit: jest.fn(),
    ...overrides,
  };
}

describe('createBillingReconciler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reports unconfigured when the management key is absent', async () => {
    const deps = createDeps({ openrouter: openrouterOf(100, false) });
    const report = await createBillingReconciler(deps).run(NOW);
    expect(report.configured).toBe(false);
    expect(deps.sendAlert).not.toHaveBeenCalled();
  });

  it('stays quiet within the 3% tolerance', async () => {
    // Ledger $100 vs OpenRouter $102 → 1.96% — no alert.
    const deps = createDeps({ openrouter: openrouterOf(102) });
    const report = await createBillingReconciler(deps).run(NOW);
    expect(report.alerted).toBe(false);
    expect(report.diffPercent).toBeCloseTo(2.0, 0);
    expect(deps.sendAlert).not.toHaveBeenCalled();
  });

  it('alerts when drift exceeds 3% and $1', async () => {
    // Ledger $100 vs OpenRouter $110 → ~9%.
    const deps = createDeps({ openrouter: openrouterOf(110) });
    const report = await createBillingReconciler(deps).run(NOW);
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
      sumCreditSpendJournal: jest.fn().mockResolvedValue({ microUsd: 500_000, count: 1 }),
      sumCreditSpendJournalRange: jest.fn().mockResolvedValue({ microUsd: 500_000, count: 1 }),
      openrouter: openrouterOf(0.1),
    });
    const report = await createBillingReconciler(deps).run(NOW);
    expect(report.alerted).toBe(false);
    expect(deps.sendAlert).not.toHaveBeenCalled();
  });

  it('flags internal journal↔counter drift in the log and report, without auto-fixing', async () => {
    // The month counter says $100 but the journal only sums to $90 → a $10 lost increment.
    const deps = createDeps({
      getCreditBillingStatus: jest.fn().mockResolvedValue(statusOf(100_000_000)),
      sumCreditSpendJournal: jest.fn().mockResolvedValue({ microUsd: 90_000_000, count: 9 }),
      openrouter: openrouterOf(100), // external side matched — isolate the internal check
    });
    const report = await createBillingReconciler(deps).run(NOW);
    expect(report.journalMicroUsd).toBe(90_000_000);
    expect(report.internalDriftMicroUsd).toBe(-10_000_000);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('INTERNAL drift'));
    // Internal drift alone must never raise an operator alert (that is for OpenRouter divergence).
    expect(deps.sendAlert).not.toHaveBeenCalled();
  });

  it('stays silent on sub-$1 journal↔counter drift (in-flight read noise)', async () => {
    const deps = createDeps({
      getCreditBillingStatus: jest.fn().mockResolvedValue(statusOf(100_000_000)),
      sumCreditSpendJournal: jest.fn().mockResolvedValue({ microUsd: 100_500_000, count: 10 }),
    });
    const report = await createBillingReconciler(deps).run(NOW);
    expect(report.internalDriftMicroUsd).toBe(500_000); // $0.50 — under the $1 tolerance
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('skips entirely in the first 6h of a UTC month (both sides read ~0)', async () => {
    const deps = createDeps();
    // 2026-08-01 02:00 UTC → UTC day 1, hour 2 (< 6) → skip.
    const report = await createBillingReconciler(deps).run(new Date('2026-08-01T02:00:00Z'));
    expect(report.reason).toMatch(/first 6h/);
    expect(report.alerted).toBe(false);
    expect(deps.openrouter.getKey).not.toHaveBeenCalled();
    expect(deps.sumCreditSpendJournal).not.toHaveBeenCalled();
    expect(deps.sumCreditSpendJournalRange).not.toHaveBeenCalled();
    expect(deps.sendAlert).not.toHaveBeenCalled();
  });

  it('runs normally once past the 6h UTC boundary window', async () => {
    const deps = createDeps();
    // 2026-08-01 07:00 UTC → UTC day 1, hour 7 (≥ 6) → no skip.
    const report = await createBillingReconciler(deps).run(new Date('2026-08-01T07:00:00Z'));
    expect(deps.openrouter.getKey).toHaveBeenCalled();
    expect(deps.sumCreditSpendJournal).toHaveBeenCalled();
    expect(deps.sumCreditSpendJournalRange).toHaveBeenCalled();
    expect(report.configured).toBe(true);
  });

  it('handles a missing usage_monthly field gracefully', async () => {
    const deps = createDeps({ openrouter: openrouterOf(null) });
    const report = await createBillingReconciler(deps).run(NOW);
    expect(report.alerted).toBe(false);
    expect(report.diffPercent).toBeNull();
    expect(report.reason).toMatch(/usage_monthly/);
  });

  it('holds the alert in the month metering started (pre-metering spend is not lost spend)', async () => {
    /* Reproduces the live 2026-07 case: the key had spent since the 1st, the ledger only
     * since the 13th → a 62% «drift» that was entirely spend from before metering. */
    const deps = createDeps({
      openrouter: openrouterOf(3.35),
      sumCreditSpendJournalRange: jest.fn().mockResolvedValue({ microUsd: 1_262_601, count: 390 }),
      getFirstCreditSpendAt: jest.fn().mockResolvedValue(new Date('2026-07-13T10:43:48Z')),
    });

    const report = await createBillingReconciler(deps).run(NOW);

    expect(report.diffPercent).toBeGreaterThan(3);
    expect(report.alerted).toBe(false);
    expect(report.reason).toMatch(/metering started mid-month/);
    expect(deps.sendAlert).not.toHaveBeenCalled();
    expect(deps.recordAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'billing.reconcile_alert' }),
    );
  });

  it('holds the alert when nothing is metered AND the key has spent nothing', async () => {
    const deps = createDeps({
      openrouter: openrouterOf(0),
      sumCreditSpendJournalRange: jest.fn().mockResolvedValue({ microUsd: 0, count: 0 }),
      getFirstCreditSpendAt: jest.fn().mockResolvedValue(null),
    });

    const report = await createBillingReconciler(deps).run(NOW);

    expect(report.alerted).toBe(false);
    expect(deps.sendAlert).not.toHaveBeenCalled();
  });

  it('ALERTS when the key is burning money and the ledger has never recorded anything', async () => {
    /* The reporter being down looks exactly like «metering just started» — but a key
     * spending real money against an empty ledger is the loudest symptom there is, and
     * suppressing it would let the contour burn invisibly for a whole month. */
    const deps = createDeps({
      openrouter: openrouterOf(50),
      sumCreditSpendJournalRange: jest.fn().mockResolvedValue({ microUsd: 0, count: 0 }),
      getFirstCreditSpendAt: jest.fn().mockResolvedValue(null),
    });

    const report = await createBillingReconciler(deps).run(NOW);

    expect(report.alerted).toBe(true);
    expect(deps.sendAlert).toHaveBeenCalled();
  });

  it('alerts once metering predates the month under comparison', async () => {
    const deps = createDeps({
      openrouter: openrouterOf(3.35),
      sumCreditSpendJournalRange: jest.fn().mockResolvedValue({ microUsd: 1_262_601, count: 390 }),
      getFirstCreditSpendAt: jest.fn().mockResolvedValue(new Date('2026-06-13T00:00:00Z')),
    });

    const report = await createBillingReconciler(deps).run(NOW);

    expect(report.alerted).toBe(true);
    expect(deps.sendAlert).toHaveBeenCalled();
  });

  it('raises the key limit to the worst-case window when the fuse is too low', async () => {
    /* $250 pool on a mid-month anchor → one UTC key window can legitimately hold two
     * periods → $550 fuse. The $300 key would have hard-cut the contour first. */
    const deps = createDeps({ openrouter: openrouterOf(100, true, 300), anchorDay: 15 });
    await createBillingReconciler(deps).run(NOW);
    expect(deps.openrouter.updateLimit).toHaveBeenCalledWith(550);
  });

  it('refuses to set a limit below what the key already burned this month', async () => {
    /* Packages drain, so the computed limit legitimately falls mid-month. Writing it
     * when it has fallen under the accrued usage would trip the key instantly and kill
     * every model while the client still has pool left — the exact outage the fuse
     * exists to prevent. $250 pool on anchor 1 → $275 desired, vs $340 already used. */
    const openrouter = openrouterOf(340, true, 385);
    const deps = createDeps({ openrouter, anchorDay: 1 });

    await createBillingReconciler(deps).run(NOW);

    expect(deps.openrouter.updateLimit).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('REFUSING'));
  });

  it('still tightens the limit while it stays clear of the accrued usage', async () => {
    const openrouter = openrouterOf(20, true, 385);
    const deps = createDeps({ openrouter, anchorDay: 1 });

    await createBillingReconciler(deps).run(NOW);

    expect(deps.openrouter.updateLimit).toHaveBeenCalledWith(275);
  });

  it('leaves the key limit untouched when it already matches', async () => {
    const deps = createDeps({ openrouter: openrouterOf(100, true, 275), anchorDay: 1 });
    await createBillingReconciler(deps).run(NOW);
    expect(deps.openrouter.updateLimit).not.toHaveBeenCalled();
  });

  it('still reconciles when the key limit sync fails', async () => {
    const openrouter = openrouterOf(100, true, 300);
    (openrouter.updateLimit as jest.Mock).mockRejectedValue(new Error('429'));
    const deps = createDeps({ openrouter, anchorDay: 15 });

    const report = await createBillingReconciler(deps).run(NOW);

    expect(report.diffPercent).toBeDefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('key limit sync failed'),
      expect.any(Error),
    );
  });

  it('never throws when OpenRouter errors', async () => {
    const openrouter: OpenRouterManagement = {
      isConfigured: true,
      getKey: jest.fn().mockRejectedValue(new Error('502')),
      updateLimit: jest.fn(),
    };
    const deps = createDeps({ openrouter });
    const report = await createBillingReconciler(deps).run(NOW);
    expect(report.configured).toBe(true);
    expect(report.alerted).toBe(false);
    expect(report.reason).toBeDefined();
  });
});
