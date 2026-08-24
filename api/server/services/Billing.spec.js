/**
 * The billing wiring's own behaviour — specifically the ledger drift check, which is
 * the load-bearing half of «the invariant is no longer hostage to OpenRouter».
 *
 * The check itself is covered in `packages/api/src/billing/reconcile.spec.ts`; what is
 * only decided here is whether it runs at all, and what the admin screen is told when it
 * does not.
 */

const mockCheckInternalDrift = jest.fn();
const mockRun = jest.fn();

jest.mock('@librechat/data-schemas', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.mock('@librechat/api', () => ({
  readBillingConfig: jest.fn(() => ({
    enabled: true,
    internalToken: 'token',
    poolCredits: 25_000,
    poolMicroUsd: 250_000_000,
    landedCostMultiplier: 1,
    serviceStartDate: null,
    anchorDay: 1,
    operatorEmails: [],
    notifyEmails: [],
    openrouter: { baseUrl: 'https://openrouter.ai/api/v1', headroom: 0.1 },
  })),
  createBillingNotifier: jest.fn(() => ({ handleSpendResult: jest.fn() })),
  createBillingReconciler: jest.fn(() => ({
    run: mockRun,
    checkInternalDrift: mockCheckInternalDrift,
  })),
  createOpenRouterManagement: jest.fn(() => ({
    isConfigured: false,
    canReadUsage: true,
    getKey: jest.fn(),
    updateLimit: jest.fn(),
  })),
}));

/* Plain mocks, like every other spec in `api/server`. These three modules EXIST, and
 * `virtual: true` means the opposite — it tells Jest not to resolve the path because
 * nothing is there. It happened to intercept on macOS and the suite was green; on the
 * Linux runner the same three tests failed with the verdict never recorded, i.e.
 * `checkCreditDrift` threw and its own catch swallowed it. Whatever the resolution
 * difference is, `virtual` was wrong here by definition, and the house convention is not. */
jest.mock('~/models', () => ({}));
jest.mock('~/server/services/Audit', () => ({ recordAudit: jest.fn() }));
jest.mock('~/server/utils', () => ({ sendEmail: jest.fn() }));

const { logger } = require('@librechat/data-schemas');
const { checkCreditDrift, getCreditDriftHealth } = require('./Billing');

describe('checkCreditDrift', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('records the verdict when the two halves agree', async () => {
    mockCheckInternalDrift.mockResolvedValue({
      month: '2026-08-01',
      journalMicroUsd: 3_228_238,
      counterMicroUsd: 3_228_238,
      rows: 864,
      driftMicroUsd: 0,
      drifted: false,
      checkedAt: new Date('2026-08-20T10:00:00Z'),
    });

    await checkCreditDrift();

    /* `checkCreditDrift` catches everything, so a broken wiring reads exactly like a
     * clean ledger: the verdict simply stays at its initial value. Assert on what the
     * catch logged BEFORE asserting the verdict — otherwise the only thing CI ever says
     * is «month: null», and the actual error never leaves the process. That is how these
     * three tests failed on the runner for a day without naming a cause. */
    expect(logger.error.mock.calls.map((call) => call.map(String).join(' '))).toEqual([]);
    expect(getCreditDriftHealth()).toMatchObject({
      drifted: false,
      driftMicroUsd: 0,
      month: '2026-08-01',
    });
  });

  it('records drift so the admin screen can say the two halves disagree', async () => {
    mockCheckInternalDrift.mockResolvedValue({
      month: '2026-08-01',
      journalMicroUsd: 3_228_238,
      counterMicroUsd: 2_228_238,
      rows: 864,
      driftMicroUsd: 1_000_000,
      drifted: true,
      checkedAt: new Date('2026-08-20T10:00:00Z'),
    });

    await checkCreditDrift();

    expect(getCreditDriftHealth()).toMatchObject({ drifted: true, driftMicroUsd: 1_000_000 });
  });

  /**
   * A check that could not run is not a clean bill of health. It must not overwrite the
   * last real verdict with «no drift» — that would turn a broken check into a green
   * screen, which is the failure mode the check exists to prevent.
   */
  it('keeps the previous verdict when the check itself fails', async () => {
    mockCheckInternalDrift.mockResolvedValue({
      month: '2026-08-01',
      journalMicroUsd: 1,
      counterMicroUsd: 0,
      rows: 1,
      driftMicroUsd: 1_000_000,
      drifted: true,
      checkedAt: new Date('2026-08-20T10:00:00Z'),
    });
    await checkCreditDrift();
    expect(getCreditDriftHealth().drifted).toBe(true);

    mockCheckInternalDrift.mockRejectedValue(new Error('mongo down'));
    await checkCreditDrift();

    expect(getCreditDriftHealth().drifted).toBe(true);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('ledger drift check failed'),
      expect.any(Error),
    );
  });

  /**
   * `drifted: false` is also what a check that has NEVER run leaves behind. Reporting
   * only that boolean means a check failing on every tick shows the screen a reconciling
   * ledger forever — the exact «green for the wrong reason» this check exists to prevent,
   * reproduced one level up.
   */
  it('says the verdict is stale before the check has ever completed', () => {
    /* Fresh registry on purpose: the health snapshot lives in module scope, so an
     * earlier test in this file would have already flipped it. */
    jest.isolateModules(() => {
      const fresh = require('./Billing');
      expect(fresh.getCreditDriftHealth()).toMatchObject({ everChecked: false, drifted: false });
    });
  });

  it('marks the verdict stale when the latest attempt threw, and fresh again after', async () => {
    mockCheckInternalDrift.mockResolvedValue({
      month: '2026-08-01',
      journalMicroUsd: 1,
      counterMicroUsd: 1,
      rows: 1,
      driftMicroUsd: 0,
      drifted: false,
      checkedAt: new Date('2026-08-20T10:00:00Z'),
    });
    await checkCreditDrift();
    expect(getCreditDriftHealth()).toMatchObject({ everChecked: true, failing: false });

    mockCheckInternalDrift.mockRejectedValue(new Error('mongo down'));
    await checkCreditDrift();
    expect(getCreditDriftHealth().failing).toBe(true);

    mockCheckInternalDrift.mockResolvedValue({
      month: '2026-08-01',
      journalMicroUsd: 1,
      counterMicroUsd: 1,
      rows: 1,
      driftMicroUsd: 0,
      drifted: false,
      checkedAt: new Date('2026-08-20T16:00:00Z'),
    });
    await checkCreditDrift();
    expect(getCreditDriftHealth().failing).toBe(false);
  });

  it('never throws — a failed check must not take the caller down', async () => {
    mockCheckInternalDrift.mockRejectedValue(new Error('boom'));

    await expect(checkCreditDrift()).resolves.toBeUndefined();
  });
});

/**
 * The reconciler takes its once-per-window alert claim BEFORE calling `sendAlert` — that
 * is what stops a structural drift mailing daily. So `sendAlert` has to SAY whether the
 * mail actually reached anyone: a send that reached nobody must give the claim back, or
 * the only automatic detector of "money left the key without reaching the ledger" goes
 * quiet for the rest of the month having sent nothing. On this stand the recipient list
 * WAS empty until 20.08.2026, so this is the measured case, not a hypothetical one.
 */
describe('sendAlert reports what it delivered', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('returns 0 when no recipients are configured', async () => {
    /* `resetModules` re-runs the jest.mock factory, so the `readBillingConfig` captured at
     * file scope is not the one `Billing.js` will call. Configure the fresh one. */
    const { readBillingConfig: freshConfig } = require('@librechat/api');
    freshConfig.mockReturnValue({
      enabled: true,
      internalToken: 'token',
      poolCredits: 25_000,
      poolMicroUsd: 250_000_000,
      landedCostMultiplier: 1,
      serviceStartDate: null,
      anchorDay: 1,
      operatorEmails: [],
      notifyEmails: [],
      openrouter: { baseUrl: 'https://openrouter.ai/api/v1', headroom: 0.1 },
    });
    /* After `resetModules` the registry is NEW: the `sendEmail` captured at file scope is
     * a different function object than the one `Billing.js` will now require. Take the
     * mock from the same registry the code under test uses, or the assertions describe a
     * module nobody called. */
    const { sendEmail: freshSendEmail } = require('~/server/utils');
    const { getBillingWiring: freshWiring } = require('./Billing');

    const delivered = await freshWiring().sendAlert({
      kind: 'reconcile',
      month: '2026-08-01',
      ledgerUsd: 3.2,
      openrouterUsd: 4.4,
      diffPercent: 26,
    });

    expect(delivered).toBe(0);
    expect(freshSendEmail).not.toHaveBeenCalled();
  });

  it('counts only the addresses the mail actually reached', async () => {
    const { readBillingConfig: freshConfig } = require('@librechat/api');
    freshConfig.mockReturnValue({
      enabled: true,
      internalToken: 'token',
      poolCredits: 25_000,
      poolMicroUsd: 250_000_000,
      landedCostMultiplier: 1,
      serviceStartDate: null,
      anchorDay: 1,
      operatorEmails: ['a@1ma.ai', 'b@1ma.ai'],
      notifyEmails: ['a@1ma.ai', 'b@1ma.ai'],
      openrouter: { baseUrl: 'https://openrouter.ai/api/v1', headroom: 0.1 },
    });
    const { sendEmail: freshSendEmail } = require('~/server/utils');
    freshSendEmail
      .mockRejectedValueOnce(new Error('smtp down'))
      .mockResolvedValueOnce({ accepted: ['b@1ma.ai'] });
    const { getBillingWiring: freshWiring } = require('./Billing');

    const delivered = await freshWiring().sendAlert({
      kind: 'reconcile',
      month: '2026-08-01',
      ledgerUsd: 3.2,
      openrouterUsd: 4.4,
      diffPercent: 26,
    });

    expect(delivered).toBe(1);
    /* The count only means something if a failed send actually surfaces: with
     * `throwError: false` the mailer logs and returns, the catch below never runs, and
     * every failure would be counted as a delivery. */
    expect(freshSendEmail).toHaveBeenCalledWith(expect.objectContaining({ throwError: true }));
  });
});

/**
 * The whole point of the ledger-drift work: the journal-vs-counter check needs nothing but
 * Mongo, and it used to live INSIDE the OpenRouter-gated branch — so on a stand without a
 * management key it was never scheduled, and never ran, for months. Silence there is
 * indistinguishable from "checked and fine".
 *
 * Nothing asserted that until now: `startBillingSchedule` was never called by this spec,
 * so moving the drift timers back under `canReadUsage` would have left every test green.
 */
describe('startBillingSchedule — the internal check is not hostage to OpenRouter', () => {
  const CONFIG = {
    enabled: true,
    internalToken: 'token',
    poolCredits: 25_000,
    poolMicroUsd: 250_000_000,
    landedCostMultiplier: 1,
    serviceStartDate: null,
    anchorDay: 1,
    operatorEmails: [],
    notifyEmails: [],
    openrouter: { baseUrl: 'https://openrouter.ai/api/v1', headroom: 0.1 },
  };

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /** Schedules with no key at all: the daily OpenRouter comparison cannot run. */
  function startWithoutOpenRouterKey() {
    const api = require('@librechat/api');
    api.readBillingConfig.mockReturnValue(CONFIG);
    api.createOpenRouterManagement.mockReturnValue({
      isConfigured: false,
      canReadUsage: false,
      getKey: jest.fn(),
      updateLimit: jest.fn(),
    });
    const { startBillingSchedule } = require('./Billing');
    return { returned: startBillingSchedule(), api };
  }

  it('still runs the journal-vs-counter check when OpenRouter cannot be read', async () => {
    const { returned, api } = startWithoutOpenRouterKey();
    const checkInternalDrift = api.createBillingReconciler.mock.results[0].value.checkInternalDrift;
    checkInternalDrift.mockResolvedValue({ drifted: false });

    // No daily reconciliation is scheduled — that part IS hostage to the key, correctly.
    expect(returned).toBeNull();

    expect(checkInternalDrift).not.toHaveBeenCalled();
    jest.advanceTimersByTime(2 * 60 * 1000);
    await Promise.resolve();
    expect(checkInternalDrift).toHaveBeenCalledTimes(1);

    // …and keeps running on its own cadence afterwards.
    jest.advanceTimersByTime(6 * 60 * 60 * 1000);
    await Promise.resolve();
    expect(checkInternalDrift).toHaveBeenCalledTimes(2);
  });

  it('says out loud that no comparison against the key itself will happen', () => {
    startWithoutOpenRouterKey();
    /* `resetModules` re-runs the jest.mock factory, so the file-scope `logger` is not the
     * one `Billing.js` wrote to. Read the fresh registry's. */
    const { logger: freshLogger } = require('@librechat/data-schemas');
    const warnings = freshLogger.warn.mock.calls.map((call) => call.map(String).join(' '));
    expect(warnings.some((line) => /no OpenRouter key available to read usage/.test(line))).toBe(
      true,
    );
  });
});
