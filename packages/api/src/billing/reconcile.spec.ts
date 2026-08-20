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
  /** Read-only access — the contour key can do this without provisioning. */
  canReadUsage = configured,
  limitRemainingUsd: number | null = 250,
  limitReset: string | null = 'monthly',
): OpenRouterManagement {
  return {
    isConfigured: configured,
    canReadUsage,
    getKey: jest.fn().mockResolvedValue({
      limitUsd,
      usageUsd: 500,
      usageMonthlyUsd,
      limitRemainingUsd,
      limitReset,
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
      canReadUsage: true,
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

describe('checkInternalDrift', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * The whole point of splitting it out: the OpenRouter comparison needs a management
   * key, and on the stand there is none — so folding the journal↔counter invariant into
   * `run` meant it was never evaluated. It must stand on its own.
   */
  it('runs with the OpenRouter management API switched off', async () => {
    const deps = createDeps({
      openrouter: openrouterOf(null, false),
      getCreditBillingStatus: jest.fn().mockResolvedValue(statusOf(100_000_000)),
      sumCreditSpendJournal: jest.fn().mockResolvedValue({ microUsd: 100_000_000, count: 7 }),
    });
    const reconciler = createBillingReconciler(deps);

    /** `run` refuses, as designed… */
    await expect(reconciler.run(NOW)).resolves.toMatchObject({ configured: false });
    /** …while the invariant that guards the «Расходы» screen is still checked. */
    const report = await reconciler.checkInternalDrift(NOW);

    expect(report).toMatchObject({
      month: '2026-07-01',
      journalMicroUsd: 100_000_000,
      counterMicroUsd: 100_000_000,
      rows: 7,
      driftMicroUsd: 0,
      drifted: false,
    });
    expect(deps.openrouter.getKey).not.toHaveBeenCalled();
  });

  it('flags a lost counter increment and records it in the audit trail', async () => {
    const recordAudit = jest.fn();
    const deps = createDeps({
      openrouter: openrouterOf(null, false),
      getCreditBillingStatus: jest.fn().mockResolvedValue(statusOf(90_000_000)),
      sumCreditSpendJournal: jest.fn().mockResolvedValue({ microUsd: 100_000_000, count: 9 }),
      recordAudit,
    });

    const report = await createBillingReconciler(deps).checkInternalDrift(NOW);

    expect(report.drifted).toBe(true);
    expect(report.driftMicroUsd).toBe(10_000_000);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('INTERNAL drift'));
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'billing.internal_drift' }),
    );
  });

  it('treats sub-dollar drift as an in-flight request, not a defect', async () => {
    const recordAudit = jest.fn();
    const deps = createDeps({
      openrouter: openrouterOf(null, false),
      getCreditBillingStatus: jest.fn().mockResolvedValue(statusOf(100_000_000)),
      /** One request landed in the journal between the two reads. */
      sumCreditSpendJournal: jest
        .fn()
        .mockResolvedValue({ microUsd: 100_500_000 - 500_000, count: 2 }),
      recordAudit,
    });

    const report = await createBillingReconciler(deps).checkInternalDrift(NOW);

    expect(report.drifted).toBe(false);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('is not re-read by run(): the status is fetched exactly once per pass', async () => {
    const getCreditBillingStatus = jest.fn().mockResolvedValue(statusOf(100_000_000));
    const deps = createDeps({ getCreditBillingStatus });

    await createBillingReconciler(deps).run(NOW);

    expect(getCreditBillingStatus).toHaveBeenCalledTimes(1);
  });

  it('reuses a status the caller already has instead of reading it again', async () => {
    const getCreditBillingStatus = jest.fn().mockResolvedValue(statusOf(100_000_000));
    const deps = createDeps({ openrouter: openrouterOf(null, false), getCreditBillingStatus });

    await createBillingReconciler(deps).checkInternalDrift(NOW, statusOf(100_000_000));

    expect(getCreditBillingStatus).not.toHaveBeenCalled();
  });
});

describe('OpenRouter key budget', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * The stand's key carries a LIFETIME cap (`limit_reset: null`): $50, of which $18 was
   * already gone when this was written. When it runs out OpenRouter disables the key and
   * every model in the contour stops at once — for everybody, mid-period. Nothing else
   * watches it.
   */
  it('warns when a non-refilling key has only months of headroom left', async () => {
    /** $10 left of $50, burning $4.4 a month → ~2.3 months. */
    const deps = createDeps({ openrouter: openrouterOf(4.4, false, 50, true, 10, null) });

    await createBillingReconciler(deps).run(NOW);

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('OpenRouter key budget is running out'),
    );
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('does NOT refill'));
  });

  /**
   * Isolates the burn-rate projection: a quarter of the limit is still left (100 of 300,
   * so the «low share» rule stays silent) and only the months-of-headroom test can fire.
   * Without it the guard was green for the wrong reason — dropping the projection
   * entirely left every test passing.
   */
  it('warns on burn rate alone, while a quarter of the limit is still left', async () => {
    const deps = createDeps({ openrouter: openrouterOf(40, false, 300, true, 100, null) });

    await createBillingReconciler(deps).run(NOW);

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('OpenRouter key budget is running out'),
    );
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('2.5 month(s)'));
  });

  /** The same numbers on a REFILLING limit must stay silent — it cannot run out. */
  it('ignores burn rate when the limit refills', async () => {
    const deps = createDeps({ openrouter: openrouterOf(40, false, 300, true, 100, 'monthly') });

    await createBillingReconciler(deps).run(NOW);

    expect(logger.error).not.toHaveBeenCalledWith(expect.stringContaining('OpenRouter key budget'));
  });

  /**
   * The stand as measured on 20.08.2026: $31.76 left of a $50 lifetime cap, burning
   * $4.39 this UTC month — about 7 months. Not yet worth shouting about, and the guard
   * must not cry wolf, or the day it does shout nobody will look.
   */
  it('stays quiet at the headroom the stand actually has today', async () => {
    const deps = createDeps({ openrouter: openrouterOf(4.39, false, 50, true, 31.76, null) });

    await createBillingReconciler(deps).run(NOW);

    expect(logger.error).not.toHaveBeenCalledWith(expect.stringContaining('OpenRouter key budget'));
  });

  it('stays quiet about a refilling limit that is merely being used', async () => {
    const deps = createDeps({ openrouter: openrouterOf(100, false, 300, true, 200, 'monthly') });

    await createBillingReconciler(deps).run(NOW);

    expect(logger.error).not.toHaveBeenCalledWith(expect.stringContaining('OpenRouter key budget'));
  });

  it('warns about a refilling limit once the window is nearly spent', async () => {
    const deps = createDeps({ openrouter: openrouterOf(100, false, 300, true, 20, 'monthly') });

    await createBillingReconciler(deps).run(NOW);

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('OpenRouter key budget is running out'),
    );
  });

  /** Reading usage needs no provisioning — that gate is what left the stand blind. */
  it('reconciles on the contour key alone, without touching the limit', async () => {
    const openrouter = openrouterOf(3.3, false, 50, true, 31.7, null);
    const deps = createDeps({ openrouter });

    const report = await createBillingReconciler(deps).run(NOW);

    expect(report.configured).toBe(true);
    expect(openrouter.getKey).toHaveBeenCalled();
    expect(openrouter.updateLimit).not.toHaveBeenCalled();
  });

  it('refuses to compare when there is no key at all', async () => {
    const deps = createDeps({ openrouter: openrouterOf(null, false, null, false) });

    const report = await createBillingReconciler(deps).run(NOW);

    expect(report).toMatchObject({ configured: false });
  });
});

describe('reconcile alert cadence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * The gap this reports does not clear on its own: spend made with the key OUTSIDE the
   * proxy (every `tools/` bench does that) can never reach the ledger, so it stands for
   * the rest of the UTC month. Alerting on every run would mail it daily — and a daily
   * alert is one nobody opens.
   */
  it('claims the alert once per period and stays quiet afterwards', async () => {
    const markCreditMonthNotified = jest
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const sendAlert = jest.fn().mockResolvedValue(undefined);
    const deps = createDeps({
      openrouter: openrouterOf(200),
      sumCreditSpendJournalRange: jest.fn().mockResolvedValue({ microUsd: 100_000_000, count: 1 }),
      markCreditMonthNotified,
      sendAlert,
    });
    const reconciler = createBillingReconciler(deps);

    const first = await reconciler.run(NOW);
    const second = await reconciler.run(NOW);

    expect(first.alerted).toBe(true);
    expect(second.alerted).toBe(false);
    expect(second.reason).toBe('already alerted for this period');
    expect(sendAlert).toHaveBeenCalledTimes(1);
    expect(markCreditMonthNotified).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'reconcile', month: '2026-07-01' }),
    );
  });

  it('still alerts when no claim function is wired', async () => {
    const sendAlert = jest.fn().mockResolvedValue(undefined);
    const deps = createDeps({
      openrouter: openrouterOf(200),
      sumCreditSpendJournalRange: jest.fn().mockResolvedValue({ microUsd: 100_000_000, count: 1 }),
      markCreditMonthNotified: undefined,
      sendAlert,
    });

    const report = await createBillingReconciler(deps).run(NOW);

    expect(report.alerted).toBe(true);
    expect(sendAlert).toHaveBeenCalledTimes(1);
  });

  /** The message must name the cause an operator can actually act on. */
  it('names spend made outside the proxy as a possible cause', async () => {
    const deps = createDeps({
      openrouter: openrouterOf(200),
      sumCreditSpendJournalRange: jest.fn().mockResolvedValue({ microUsd: 100_000_000, count: 1 }),
    });

    await createBillingReconciler(deps).run(NOW);

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('OUTSIDE the proxy'));
  });
});
