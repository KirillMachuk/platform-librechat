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

jest.mock('~/models', () => ({}), { virtual: true });
jest.mock('~/server/services/Audit', () => ({ recordAudit: jest.fn() }), { virtual: true });
jest.mock('~/server/utils', () => ({ sendEmail: jest.fn() }), { virtual: true });

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

  it('never throws — a failed check must not take the caller down', async () => {
    mockCheckInternalDrift.mockRejectedValue(new Error('boom'));

    await expect(checkCreditDrift()).resolves.toBeUndefined();
  });
});
