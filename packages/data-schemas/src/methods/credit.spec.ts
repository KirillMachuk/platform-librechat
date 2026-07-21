import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { creditsToMicroUsd, microUsdToCredits, usdToMicroUsd } from '~/common/credit';
import { createCreditMethods, servicePeriodKey, servicePeriodBounds } from './credit';
import { createModels } from '~/models';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

let mongoServer: InstanceType<typeof MongoMemoryServer>;
let methods: ReturnType<typeof createCreditMethods>;

/** 100-credit pool ($1) keeps the arithmetic in the tests readable. */
const POOL = creditsToMicroUsd(100);

function spend(params: {
  credits?: number;
  microUsd?: number;
  at?: Date;
  sourceId?: string;
  model?: string;
  anchorDay?: number;
}) {
  return methods.recordCreditSpend({
    microUsd: params.microUsd ?? creditsToMicroUsd(params.credits ?? 0),
    poolMicroUsd: POOL,
    at: params.at,
    sourceId: params.sourceId,
    model: params.model,
    anchorDay: params.anchorDay,
  });
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const models = createModels(mongoose);
  Object.assign(mongoose.models, models);
  methods = createCreditMethods(mongoose);
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  // dropDatabase removes indexes; the idempotency guarantees under test are
  // enforced by unique indexes, so rebuild them like a fresh deployment would.
  await Promise.all([
    mongoose.models.CreditMonth.syncIndexes(),
    mongoose.models.CreditPackage.syncIndexes(),
    mongoose.models.CreditSpend.syncIndexes(),
  ]);
});

describe('servicePeriodKey (rolling «month of service»)', () => {
  test('anchorDay=1 reproduces calendar-month keys, in Europe/Minsk (UTC+3) not UTC', () => {
    // 20:59 UTC on Jul 31 is 23:59 in Minsk — still July.
    expect(servicePeriodKey(new Date('2026-07-31T20:59:00Z'), 1)).toBe('2026-07-01');
    // 21:00 UTC on Jul 31 is 00:00 Aug 1 in Minsk — the pool resets here.
    expect(servicePeriodKey(new Date('2026-07-31T21:00:00Z'), 1)).toBe('2026-08-01');
    expect(servicePeriodKey(new Date('2026-12-31T21:00:00Z'), 1)).toBe('2027-01-01');
    // Default anchor is 1.
    expect(servicePeriodKey(new Date('2026-07-15T12:00:00Z'))).toBe('2026-07-01');
  });

  test('anchorDay=15: the period runs 15th→15th (Minsk midnight boundary)', () => {
    // Mid-period.
    expect(servicePeriodKey(new Date('2026-07-20T12:00:00Z'), 15)).toBe('2026-07-15');
    // Before the anchor → previous period.
    expect(servicePeriodKey(new Date('2026-07-10T12:00:00Z'), 15)).toBe('2026-06-15');
    // 21:00 UTC on Jul 14 = 00:00 Jul 15 Minsk → the new period starts exactly here.
    expect(servicePeriodKey(new Date('2026-07-14T20:59:00Z'), 15)).toBe('2026-06-15');
    expect(servicePeriodKey(new Date('2026-07-14T21:00:00Z'), 15)).toBe('2026-07-15');
  });

  test('anchorDay=31 clamps to the last day where the 31st does not exist', () => {
    // Jan has 31; period keyed 01-31.
    expect(servicePeriodKey(new Date('2026-01-31T12:00:00Z'), 31)).toBe('2026-01-31');
    // Feb (28 days, 2026 non-leap): the period that started Jan 31 clamps to Feb 28.
    expect(servicePeriodKey(new Date('2026-02-15T12:00:00Z'), 31)).toBe('2026-01-31');
    // On Feb 28 the next period begins (clamped anchor).
    expect(servicePeriodKey(new Date('2026-02-28T12:00:00Z'), 31)).toBe('2026-02-28');
    // March has 31 again → the anchor returns to 31.
    expect(servicePeriodKey(new Date('2026-03-15T12:00:00Z'), 31)).toBe('2026-02-28');
    expect(servicePeriodKey(new Date('2026-03-31T12:00:00Z'), 31)).toBe('2026-03-31');
    // The period [03-31, 04-30) ends on Apr 30 (April has no 31st) → Apr 29 is still 03-31.
    expect(servicePeriodKey(new Date('2026-04-29T12:00:00Z'), 31)).toBe('2026-03-31');
    // Apr 30 begins the next period (clamped anchor 30) → [04-30, 05-31).
    expect(servicePeriodKey(new Date('2026-04-30T12:00:00Z'), 31)).toBe('2026-04-30');
    expect(servicePeriodKey(new Date('2026-05-01T12:00:00Z'), 31)).toBe('2026-04-30');
  });

  test('leap February: anchorDay=30 clamps to Feb 29 in a leap year', () => {
    // 2028 is a leap year.
    expect(servicePeriodKey(new Date('2028-02-29T12:00:00Z'), 30)).toBe('2028-02-29');
    expect(servicePeriodKey(new Date('2028-02-28T12:00:00Z'), 30)).toBe('2028-01-30');
  });

  test('servicePeriodBounds returns Minsk-midnight [start, end); anchor=31 through Feb', () => {
    const { start, end } = servicePeriodBounds(new Date('2026-02-10T12:00:00Z'), 31);
    // Period [Jan 31 00:00 Minsk, Feb 28 00:00 Minsk) = [Jan 30 21:00 UTC, Feb 27 21:00 UTC).
    expect(start.toISOString()).toBe('2026-01-30T21:00:00.000Z');
    expect(end.toISOString()).toBe('2026-02-27T21:00:00.000Z');
  });
});

describe('recordCreditSpend / monthly pool', () => {
  test('accumulates spend and reports pool/threshold crossings exactly once', async () => {
    const at = new Date('2026-07-10T12:00:00Z');

    let r = await spend({ credits: 79, at });
    expect(r.month).toBe('2026-07-01');
    expect(r.crossed80).toBe(false);
    expect(r.crossedPool).toBe(false);

    // 79 → 81 crosses the 80% threshold of a 100-credit pool.
    r = await spend({ credits: 2, at });
    expect(r.crossed80).toBe(true);
    expect(r.crossedPool).toBe(false);

    // 81 → 99 crosses nothing.
    r = await spend({ credits: 18, at });
    expect(r.crossed80).toBe(false);

    // 99 → 101 crosses the pool boundary.
    r = await spend({ credits: 2, at });
    expect(r.crossedPool).toBe(true);
    expect(r.spentAfterMicroUsd).toBe(creditsToMicroUsd(101));
  });

  test('a new Minsk month starts a fresh pool (reset on the 1st, no rollover)', async () => {
    const july = new Date('2026-07-31T20:59:00Z');
    const august = new Date('2026-07-31T21:00:00Z');

    await spend({ credits: 101, at: july });
    const julyStatus = await methods.getCreditBillingStatus({ poolMicroUsd: POOL, at: july });
    expect(julyStatus.blocked).toBe(true);

    const augustStatus = await methods.getCreditBillingStatus({ poolMicroUsd: POOL, at: august });
    expect(augustStatus.month).toBe('2026-08-01');
    expect(augustStatus.spentMicroUsd).toBe(0);
    expect(augustStatus.blocked).toBe(false);

    // July's overspend still drains packages globally (1 credit overflow).
    expect(augustStatus.packageSpentMicroUsd).toBe(creditsToMicroUsd(1));
  });

  test('dedupes by sourceId: a reporter retry never double-counts', async () => {
    const at = new Date('2026-07-10T12:00:00Z');
    const first = await spend({ credits: 5, at, sourceId: 'gen-abc' });
    expect(first.duplicate).toBe(false);

    const retry = await spend({ credits: 5, at, sourceId: 'gen-abc' });
    expect(retry.duplicate).toBe(true);
    expect(retry.spentAfterMicroUsd).toBe(creditsToMicroUsd(5));

    const journal = await methods.sumCreditSpendJournal({ month: '2026-07-01' });
    expect(journal.count).toBe(1);
    expect(journal.microUsd).toBe(creditsToMicroUsd(5));
  });

  test('keeps the pool snapshot taken at month creation', async () => {
    const at = new Date('2026-07-10T12:00:00Z');
    await spend({ credits: 1, at });
    const status = await methods.getCreditBillingStatus({
      poolMicroUsd: creditsToMicroUsd(999),
      at,
    });
    expect(status.poolMicroUsd).toBe(POOL);
  });

  test('parallel spends aggregate atomically', async () => {
    const at = new Date('2026-07-10T12:00:00Z');
    await Promise.all(Array.from({ length: 25 }, (_, i) => spend({ microUsd: 1000 + i, at })));
    const status = await methods.getCreditBillingStatus({ poolMicroUsd: POOL, at });
    const expected = Array.from({ length: 25 }, (_, i) => 1000 + i).reduce((a, b) => a + b, 0);
    expect(status.spentMicroUsd).toBe(expected);
    expect(status.requestCount).toBe(25);
  });
});

describe('deduction order: pool first, then packages', () => {
  test('packages are only drained by the overflow beyond the monthly pool', async () => {
    const at = new Date('2026-07-10T12:00:00Z');
    await methods.addCreditPackage({ credits: 50, idempotencyKey: 'k1', at });

    // 60 spent of a 100 pool — packages untouched.
    await spend({ credits: 60, at });
    let status = await methods.getCreditBillingStatus({ poolMicroUsd: POOL, at });
    expect(status.packageSpentMicroUsd).toBe(0);
    expect(status.packageRemainingMicroUsd).toBe(creditsToMicroUsd(50));
    expect(status.blocked).toBe(false);

    // 60 more → 120 total: 20 credits drain from the package.
    await spend({ credits: 60, at });
    status = await methods.getCreditBillingStatus({ poolMicroUsd: POOL, at });
    expect(status.packageSpentMicroUsd).toBe(creditsToMicroUsd(20));
    expect(status.packageRemainingMicroUsd).toBe(creditsToMicroUsd(30));
    expect(status.blocked).toBe(false);

    // 30 more → packages fully drained → soft block.
    await spend({ credits: 30, at });
    status = await methods.getCreditBillingStatus({ poolMicroUsd: POOL, at });
    expect(status.packageRemainingMicroUsd).toBe(0);
    expect(status.blocked).toBe(true);
  });

  test('FIFO lot allocation for display/refunds', async () => {
    const at = new Date('2026-07-10T12:00:00Z');
    await methods.addCreditPackage({ credits: 50, idempotencyKey: 'lot-1', at });
    await methods.addCreditPackage({ credits: 100, idempotencyKey: 'lot-2', at });

    // Overflow of 70 credits: lot-1 (older) drains fully, lot-2 partially.
    await spend({ credits: 170, at });
    const { packages, packageSpentMicroUsd } = await methods.listCreditPackages();
    expect(packageSpentMicroUsd).toBe(creditsToMicroUsd(70));
    // Newest-first for display.
    expect(packages.map((p) => p.credits)).toEqual([100, 50]);
    expect(packages[1].remainingMicroUsd).toBe(0);
    expect(packages[0].remainingMicroUsd).toBe(creditsToMicroUsd(80));
  });
});

describe('addCreditPackage idempotency & unblocking', () => {
  test('a replayed idempotency key adds nothing and returns the original lot', async () => {
    const first = await methods.addCreditPackage({
      credits: 5000,
      comment: 'Счёт №42',
      idempotencyKey: 'same-key',
    });
    const replay = await methods.addCreditPackage({
      credits: 5000,
      comment: 'Счёт №42 (повторный клик)',
      idempotencyKey: 'same-key',
    });
    expect(first.created).toBe(true);
    expect(replay.created).toBe(false);
    expect(String(replay.package._id)).toBe(String(first.package._id));

    const { packages } = await methods.listCreditPackages();
    expect(packages).toHaveLength(1);
    expect(packages[0].comment).toBe('Счёт №42');
  });

  test('adding a package lifts the soft block and re-arms the exhausted notification', async () => {
    const at = new Date('2026-07-10T12:00:00Z');
    await spend({ credits: 101, at });

    let status = await methods.getCreditBillingStatus({ poolMicroUsd: POOL, at });
    expect(status.blocked).toBe(true);
    expect(await methods.markCreditMonthNotified({ month: '2026-07-01', kind: 'exhausted' })).toBe(
      true,
    );

    await methods.addCreditPackage({ credits: 50, idempotencyKey: 'refill', at });
    status = await methods.getCreditBillingStatus({ poolMicroUsd: POOL, at });
    expect(status.blocked).toBe(false);
    expect(status.notifiedExhaustedAt).toBeNull();

    // Re-exhaustion can notify again (flag was reset by the top-up).
    await spend({ credits: 49, at });
    status = await methods.getCreditBillingStatus({ poolMicroUsd: POOL, at });
    expect(status.blocked).toBe(true);
    expect(await methods.markCreditMonthNotified({ month: '2026-07-01', kind: 'exhausted' })).toBe(
      true,
    );
  });
});

describe('manual adjustments (refunds and clawbacks)', () => {
  const at = new Date('2026-07-10T12:00:00Z');

  test('a lot defaults to kind=package and a package may not be negative', async () => {
    await methods.addCreditPackage({ credits: 50, idempotencyKey: 'plain', at });
    const { packages } = await methods.listCreditPackages();
    expect(packages[0].kind).toBe('package');

    await expect(
      methods.addCreditPackage({ credits: -50, idempotencyKey: 'bad', at }),
    ).rejects.toThrow(/cannot be negative/);
    await expect(
      methods.addCreditPackage({ kind: 'adjustment', credits: 0, idempotencyKey: 'zero', at }),
    ).rejects.toThrow(/invalid lot size/);
  });

  test('a positive adjustment grants credits and lifts the soft block', async () => {
    await spend({ credits: 101, at });
    expect((await methods.getCreditBillingStatus({ poolMicroUsd: POOL, at })).blocked).toBe(true);

    await methods.addCreditPackage({
      kind: 'adjustment',
      credits: 40,
      comment: 'возврат: сбой 2026-07-10',
      idempotencyKey: 'refund-1',
      at,
    });

    const status = await methods.getCreditBillingStatus({ poolMicroUsd: POOL, at });
    expect(status.blocked).toBe(false);
    expect(status.packageRemainingMicroUsd).toBe(creditsToMicroUsd(39));
  });

  test('a negative adjustment claws credits back and can re-block the contour', async () => {
    await methods.addCreditPackage({ credits: 50, idempotencyKey: 'lot-1', at });
    await spend({ credits: 120, at });

    let status = await methods.getCreditBillingStatus({ poolMicroUsd: POOL, at });
    expect(status.blocked).toBe(false);
    expect(status.packageRemainingMicroUsd).toBe(creditsToMicroUsd(30));

    await methods.addCreditPackage({
      kind: 'adjustment',
      credits: -30,
      comment: 'откат ошибочного начисления',
      idempotencyKey: 'clawback-1',
      at,
    });

    status = await methods.getCreditBillingStatus({ poolMicroUsd: POOL, at });
    expect(status.packageRemainingMicroUsd).toBe(0);
    expect(status.blocked).toBe(true);
  });

  test('a negative adjustment does NOT re-arm the exhausted notification', async () => {
    await spend({ credits: 101, at });
    expect(await methods.markCreditMonthNotified({ month: '2026-07-01', kind: 'exhausted' })).toBe(
      true,
    );

    await methods.addCreditPackage({
      kind: 'adjustment',
      credits: -10,
      comment: 'клавбек',
      idempotencyKey: 'clawback-2',
      at,
    });

    const status = await methods.getCreditBillingStatus({ poolMicroUsd: POOL, at });
    expect(status.notifiedExhaustedAt).not.toBeNull();
  });

  test('the lot table still reconciles with the headline remainder', async () => {
    /* The regression this guards: a negative lot flowing through the per-lot FIFO
     * arithmetic ran the drain backwards, so the rows on screen no longer summed to
     * the «Остаток пакетов» above them. */
    await methods.addCreditPackage({ credits: 50, idempotencyKey: 'lot-1', at });
    await methods.addCreditPackage({ credits: 100, idempotencyKey: 'lot-2', at });
    await methods.addCreditPackage({
      kind: 'adjustment',
      credits: -20,
      comment: 'клавбек',
      idempotencyKey: 'adj-1',
      at,
    });
    await spend({ credits: 170, at });

    const status = await methods.getCreditBillingStatus({ poolMicroUsd: POOL, at });
    const { packages } = await methods.listCreditPackages();
    const shownTotal = packages.reduce((sum, lot) => sum + lot.remainingMicroUsd, 0);

    expect(status.packageRemainingMicroUsd).toBe(creditsToMicroUsd(60));
    expect(shownTotal).toBe(status.packageRemainingMicroUsd);
    // Oldest positive lot drains first; the adjustment itself holds no balance.
    expect(packages.map((lot) => lot.remainingMicroUsd)).toEqual([0, creditsToMicroUsd(60), 0]);
  });
});

describe('notification single-winner', () => {
  test('markCreditMonthNotified wins exactly once per kind', async () => {
    const at = new Date('2026-07-10T12:00:00Z');
    await spend({ credits: 81, at });

    const [a, b] = await Promise.all([
      methods.markCreditMonthNotified({ month: '2026-07-01', kind: '80' }),
      methods.markCreditMonthNotified({ month: '2026-07-01', kind: '80' }),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(await methods.markCreditMonthNotified({ month: '2026-07-01', kind: '80' })).toBe(false);
  });
});

describe('rounding convergence (micro-USD ledger)', () => {
  test('journal sum equals the month counter exactly; display rounds once', async () => {
    const at = new Date('2026-07-10T12:00:00Z');
    // 200 requests with awkward real-world costs (e.g. $0.0123456…).
    const costsUsd = Array.from({ length: 200 }, (_, i) => 0.0123456 + i * 0.0007891);
    let expectedMicro = 0;
    for (const usd of costsUsd) {
      const micro = usdToMicroUsd(usd);
      expectedMicro += micro;
      await spend({ microUsd: micro, at });
    }

    const status = await methods.getCreditBillingStatus({ poolMicroUsd: POOL, at });
    const journal = await methods.sumCreditSpendJournal({ month: '2026-07-01' });

    expect(status.spentMicroUsd).toBe(expectedMicro);
    expect(journal.microUsd).toBe(expectedMicro);
    expect(journal.count).toBe(costsUsd.length);

    // Displayed whole Credits deviate from the true USD total by < 1 Credit —
    // rounding happens once at display, not per request.
    const trueUsd = costsUsd.reduce((a, b) => a + b, 0);
    expect(Math.abs(microUsdToCredits(status.spentMicroUsd) - trueUsd * 100)).toBeLessThan(1);
  });
});

describe('service-period anchor end-to-end', () => {
  const ANCHOR = 15;

  test('spend + status use the anchored period key and expose its bounds', async () => {
    const at = new Date('2026-07-20T12:00:00Z'); // inside [Jul 15, Aug 15)
    const r = await spend({ credits: 10, at, anchorDay: ANCHOR });
    expect(r.month).toBe('2026-07-15');

    const status = await methods.getCreditBillingStatus({
      poolMicroUsd: POOL,
      at,
      anchorDay: ANCHOR,
    });
    expect(status.month).toBe('2026-07-15');
    expect(status.spentMicroUsd).toBe(creditsToMicroUsd(10));
    // [Jul 15 00:00 Minsk, Aug 15 00:00 Minsk) = [Jul 14 21:00 UTC, Aug 14 21:00 UTC).
    expect(status.periodStart?.toISOString()).toBe('2026-07-14T21:00:00.000Z');
    expect(status.periodEnd?.toISOString()).toBe('2026-08-14T21:00:00.000Z');
  });

  test('crossing the anchor boundary starts a fresh pool with no rollover', async () => {
    const before = new Date('2026-07-14T20:59:00Z'); // 23:59 Minsk Jul 14 → period Jun 15
    const after = new Date('2026-07-14T21:00:00Z'); //  00:00 Minsk Jul 15 → period Jul 15

    await spend({ credits: 101, at: before, anchorDay: ANCHOR });
    const prev = await methods.getCreditBillingStatus({
      poolMicroUsd: POOL,
      at: before,
      anchorDay: ANCHOR,
    });
    expect(prev.month).toBe('2026-06-15');
    expect(prev.blocked).toBe(true);

    const next = await methods.getCreditBillingStatus({
      poolMicroUsd: POOL,
      at: after,
      anchorDay: ANCHOR,
    });
    expect(next.month).toBe('2026-07-15');
    expect(next.spentMicroUsd).toBe(0);
    expect(next.blocked).toBe(false);
    // The previous period's overspend still drains packages globally (1 credit overflow).
    expect(next.packageSpentMicroUsd).toBe(creditsToMicroUsd(1));
  });

  test('getCreditGateStatus is read-only: a gate check creates no period document', async () => {
    const at = new Date('2026-07-20T12:00:00Z');
    const gate = await methods.getCreditGateStatus({ poolMicroUsd: POOL, at, anchorDay: ANCHOR });
    expect(gate.month).toBe('2026-07-15');
    expect(gate.spentMicroUsd).toBe(0);
    expect(gate.blocked).toBe(false);
    // Unlike getCreditBillingStatus, the gate must NOT have upserted a document.
    expect(await methods.getCreditMonth({ month: '2026-07-15' })).toBeNull();
  });

  test('getCreditGateStatus reflects a real spend and blocks when the pool is exhausted', async () => {
    const at = new Date('2026-07-20T12:00:00Z');
    await spend({ credits: 101, at, anchorDay: ANCHOR });
    const gate = await methods.getCreditGateStatus({ poolMicroUsd: POOL, at, anchorDay: ANCHOR });
    expect(gate.spentMicroUsd).toBe(creditsToMicroUsd(101));
    expect(gate.blocked).toBe(true);
  });
});

describe('sumCreditSpendJournalRange (external reconcile window, by createdAt)', () => {
  test('sums journal rows whose createdAt falls in [from, to)', async () => {
    // createdAt is the real insertion time, independent of the period `at`; use a
    // window around "now" so the assertion holds regardless of the wall clock.
    await spend({ credits: 3, at: new Date('2026-07-05T10:00:00Z'), anchorDay: 15, sourceId: 'a' });
    await spend({ credits: 7, at: new Date('2026-07-25T10:00:00Z'), anchorDay: 15, sourceId: 'b' });

    const now = Date.now();
    const wide = await methods.sumCreditSpendJournalRange({
      from: new Date(now - 60 * 60 * 1000),
      to: new Date(now + 60 * 60 * 1000),
    });
    expect(wide.count).toBe(2);
    expect(wide.microUsd).toBe(creditsToMicroUsd(10));

    // A window entirely in the past excludes both rows.
    const past = await methods.sumCreditSpendJournalRange({
      from: new Date(now - 48 * 60 * 60 * 1000),
      to: new Date(now - 24 * 60 * 60 * 1000),
    });
    expect(past.count).toBe(0);
    expect(past.microUsd).toBe(0);
  });
});
