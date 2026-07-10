import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { creditsToMicroUsd, microUsdToCredits, usdToMicroUsd } from '~/common/credit';
import { createCreditMethods, minskMonthKey } from './credit';
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
}) {
  return methods.recordCreditSpend({
    microUsd: params.microUsd ?? creditsToMicroUsd(params.credits ?? 0),
    poolMicroUsd: POOL,
    at: params.at,
    sourceId: params.sourceId,
    model: params.model,
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

describe('minskMonthKey', () => {
  test('keys by the Europe/Minsk (UTC+3) calendar, not UTC', () => {
    // 20:59 UTC on Jul 31 is 23:59 in Minsk — still July.
    expect(minskMonthKey(new Date('2026-07-31T20:59:00Z'))).toBe('2026-07');
    // 21:00 UTC on Jul 31 is 00:00 Aug 1 in Minsk — the pool resets here.
    expect(minskMonthKey(new Date('2026-07-31T21:00:00Z'))).toBe('2026-08');
    expect(minskMonthKey(new Date('2026-12-31T21:00:00Z'))).toBe('2027-01');
  });
});

describe('recordCreditSpend / monthly pool', () => {
  test('accumulates spend and reports pool/threshold crossings exactly once', async () => {
    const at = new Date('2026-07-10T12:00:00Z');

    let r = await spend({ credits: 79, at });
    expect(r.month).toBe('2026-07');
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
    expect(augustStatus.month).toBe('2026-08');
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

    const journal = await methods.sumCreditSpendJournal({ month: '2026-07' });
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
    await Promise.all(
      Array.from({ length: 25 }, (_, i) => spend({ microUsd: 1000 + i, at })),
    );
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
    expect(await methods.markCreditMonthNotified({ month: '2026-07', kind: 'exhausted' })).toBe(
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
    expect(await methods.markCreditMonthNotified({ month: '2026-07', kind: 'exhausted' })).toBe(
      true,
    );
  });
});

describe('notification single-winner', () => {
  test('markCreditMonthNotified wins exactly once per kind', async () => {
    const at = new Date('2026-07-10T12:00:00Z');
    await spend({ credits: 81, at });

    const [a, b] = await Promise.all([
      methods.markCreditMonthNotified({ month: '2026-07', kind: '80' }),
      methods.markCreditMonthNotified({ month: '2026-07', kind: '80' }),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(await methods.markCreditMonthNotified({ month: '2026-07', kind: '80' })).toBe(false);
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
    const journal = await methods.sumCreditSpendJournal({ month: '2026-07' });

    expect(status.spentMicroUsd).toBe(expectedMicro);
    expect(journal.microUsd).toBe(expectedMicro);
    expect(journal.count).toBe(costsUsd.length);

    // Displayed whole Credits deviate from the true USD total by < 1 Credit —
    // rounding happens once at display, not per request.
    const trueUsd = costsUsd.reduce((a, b) => a + b, 0);
    expect(Math.abs(microUsdToCredits(status.spentMicroUsd) - trueUsd * 100)).toBeLessThan(1);
  });
});
