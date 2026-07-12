import type { CreditBillingStatus, RecordCreditSpendResult } from '@librechat/data-schemas';
import type { BillingNotifierDeps } from './notify';
import { createBillingNotifier } from './notify';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const POOL = 1_000_000; // 100 credits in µ$ — keeps math obvious

function spendResult(overrides: Partial<RecordCreditSpendResult> = {}): RecordCreditSpendResult {
  return {
    duplicate: false,
    month: '2026-07',
    poolMicroUsd: POOL,
    spentBeforeMicroUsd: 0,
    spentAfterMicroUsd: 0,
    crossed80: false,
    crossedPool: false,
    notified80At: null,
    notifiedExhaustedAt: null,
    ...overrides,
  };
}

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

function createDeps(overrides: Partial<BillingNotifierDeps> = {}): BillingNotifierDeps {
  return {
    getCreditBillingStatus: jest.fn().mockResolvedValue(statusOf()),
    markCreditMonthNotified: jest.fn().mockResolvedValue(true),
    poolMicroUsd: POOL,
    sendAlert: jest.fn().mockResolvedValue(undefined),
    recordAudit: jest.fn(),
    ...overrides,
  };
}

describe('createBillingNotifier', () => {
  it('sends the 80% alert once (only the claim winner sends)', async () => {
    const deps = createDeps();
    const notifier = createBillingNotifier(deps);

    await notifier.handleSpendResult(
      spendResult({ crossed80: true, spentBeforeMicroUsd: 790_000, spentAfterMicroUsd: 810_000 }),
    );

    expect(deps.markCreditMonthNotified).toHaveBeenCalledWith(
      expect.objectContaining({ kind: '80', month: '2026-07' }),
    );
    expect(deps.sendAlert).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'pool80', percentUsed: 81, poolCredits: 100 }),
    );
    expect(deps.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'billing.threshold_80' }),
    );
  });

  it('stays silent when another writer already claimed the flag', async () => {
    const deps = createDeps({ markCreditMonthNotified: jest.fn().mockResolvedValue(false) });
    const notifier = createBillingNotifier(deps);

    await notifier.handleSpendResult(spendResult({ crossed80: true, spentAfterMicroUsd: 810_000 }));

    expect(deps.sendAlert).not.toHaveBeenCalled();
    expect(deps.recordAudit).not.toHaveBeenCalled();
  });

  it('skips the 80% path when the month is already marked notified', async () => {
    const deps = createDeps();
    const notifier = createBillingNotifier(deps);

    await notifier.handleSpendResult(
      spendResult({ crossed80: true, notified80At: new Date(), spentAfterMicroUsd: 810_000 }),
    );

    expect(deps.markCreditMonthNotified).not.toHaveBeenCalled();
    expect(deps.sendAlert).not.toHaveBeenCalled();
  });

  it('sends the exhausted alert only when packages are also drained (blocked)', async () => {
    const deps = createDeps({
      getCreditBillingStatus: jest
        .fn()
        .mockResolvedValue(
          statusOf({ spentMicroUsd: 1_050_000, packageRemainingMicroUsd: 0, blocked: true }),
        ),
    });
    const notifier = createBillingNotifier(deps);

    await notifier.handleSpendResult(
      spendResult({ spentBeforeMicroUsd: 990_000, spentAfterMicroUsd: 1_050_000 }),
    );

    expect(deps.markCreditMonthNotified).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'exhausted' }),
    );
    expect(deps.sendAlert).toHaveBeenCalledWith(expect.objectContaining({ kind: 'exhausted' }));
    expect(deps.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'billing.exhausted' }),
    );
  });

  it('does not alert exhaustion while package credits remain', async () => {
    const deps = createDeps({
      getCreditBillingStatus: jest
        .fn()
        .mockResolvedValue(
          statusOf({ spentMicroUsd: 1_050_000, packageRemainingMicroUsd: 100_000, blocked: false }),
        ),
    });
    const notifier = createBillingNotifier(deps);

    await notifier.handleSpendResult(
      spendResult({ spentBeforeMicroUsd: 990_000, spentAfterMicroUsd: 1_050_000 }),
    );

    expect(deps.markCreditMonthNotified).not.toHaveBeenCalled();
    expect(deps.sendAlert).not.toHaveBeenCalled();
  });

  it('ignores duplicate (deduped) spend results', async () => {
    const deps = createDeps();
    const notifier = createBillingNotifier(deps);

    await notifier.handleSpendResult(
      spendResult({ duplicate: true, crossed80: true, spentAfterMicroUsd: 810_000 }),
    );

    expect(deps.markCreditMonthNotified).not.toHaveBeenCalled();
  });

  it('never throws when the alert channel fails', async () => {
    const deps = createDeps({ sendAlert: jest.fn().mockRejectedValue(new Error('smtp down')) });
    const notifier = createBillingNotifier(deps);

    await expect(
      notifier.handleSpendResult(spendResult({ crossed80: true, spentAfterMicroUsd: 810_000 })),
    ).resolves.toBeUndefined();
  });
});
