import { readBillingConfig, recipientsForAlert } from './config';

/** Anchor-day derivation from BILLING_SERVICE_START_DATE — the switch between calendar
 *  month (anchor 1) and the rolling «month of service». Money-adjacent, so pinned. */
describe('readBillingConfig — service period anchor', () => {
  const base = { BILLING_INTERNAL_TOKEN: 'secret' } as NodeJS.ProcessEnv;

  function anchorFor(serviceStartDate?: string): number {
    return readBillingConfig({ ...base, BILLING_SERVICE_START_DATE: serviceStartDate }).anchorDay;
  }

  test('unset → anchor day 1 (calendar-month billing)', () => {
    expect(anchorFor(undefined)).toBe(1);
    expect(anchorFor('')).toBe(1);
    expect(readBillingConfig(base).anchorDay).toBe(1);
    expect(readBillingConfig(base).serviceStartDate).toBeNull();
  });

  test('valid YYYY-MM-DD → its day of month', () => {
    expect(anchorFor('2026-08-15')).toBe(15);
    expect(anchorFor('2026-08-01')).toBe(1);
    expect(anchorFor('2026-12-31')).toBe(31);
    expect(
      readBillingConfig({ ...base, BILLING_SERVICE_START_DATE: '2026-08-15' }).serviceStartDate,
    ).toBe('2026-08-15');
  });

  test('lenient on zero-padding: 2026-8-5 == day 5', () => {
    expect(anchorFor('2026-8-5')).toBe(5);
    expect(anchorFor('2026-8-05')).toBe(5);
    expect(anchorFor('  2026-08-09  ')).toBe(9);
  });

  test('out-of-range or garbage → falls back to anchor 1 (never breaks billing)', () => {
    expect(anchorFor('2026-13-40')).toBe(1); // month & day out of range
    expect(anchorFor('2026-00-00')).toBe(1);
    expect(anchorFor('not-a-date')).toBe(1);
    expect(anchorFor('2026/08/15')).toBe(1); // wrong separators
    expect(anchorFor('15')).toBe(1);
  });

  test('day 29/30/31 are accepted (clamped later, at period computation)', () => {
    expect(anchorFor('2026-02-31')).toBe(31);
    expect(anchorFor('2026-02-29')).toBe(29);
    expect(anchorFor('2026-04-30')).toBe(30);
  });
});

describe('readBillingConfig — landed cost', () => {
  const base = { BILLING_INTERNAL_TOKEN: 'secret' } as NodeJS.ProcessEnv;

  test('defaults to legacy 1:1 accounting', () => {
    expect(readBillingConfig(base).landedCostMultiplier).toBe(1);
  });

  test('accepts a payment and FX uplift', () => {
    expect(
      readBillingConfig({ ...base, BILLING_LANDED_COST_MULTIPLIER: '1.25' }).landedCostMultiplier,
    ).toBe(1.25);
  });

  test.each(['0.99', '0', '-1', 'invalid', '1.25oops'])('fails safe to 1 for %s', (value) => {
    expect(
      readBillingConfig({ ...base, BILLING_LANDED_COST_MULTIPLIER: value }).landedCostMultiplier,
    ).toBe(1);
  });
});

/** Who each alert reaches. The reconcile mail names the upstream provider and our cost
 *  basis, so it must never widen to the client's coordinators — that is the whole point
 *  of the split, and a regression here leaks commercial data to the customer. */
describe('recipientsForAlert — client alerts widen, operator alerts do not', () => {
  const operators = ['ops-a@example.com', 'ops-b@example.com'];

  test('no client list configured → every kind goes to the operators only', () => {
    const config = { notifyEmails: operators, clientEmails: [] };
    expect(recipientsForAlert(config, 'pool80')).toEqual(operators);
    expect(recipientsForAlert(config, 'exhausted')).toEqual(operators);
    expect(recipientsForAlert(config, 'reconcile')).toEqual(operators);
  });

  test('client list configured → only the client-facing kinds include it', () => {
    const config = { notifyEmails: operators, clientEmails: ['coordinator@client.example'] };
    expect(recipientsForAlert(config, 'pool80')).toEqual([...operators, 'coordinator@client.example']);
    expect(recipientsForAlert(config, 'exhausted')).toEqual([
      ...operators,
      'coordinator@client.example',
    ]);
    expect(recipientsForAlert(config, 'reconcile')).toEqual(operators);
    expect(recipientsForAlert(config, 'reconcile')).not.toContain('coordinator@client.example');
  });

  test('an address on both lists is mailed once', () => {
    const config = { notifyEmails: operators, clientEmails: ['ops-a@example.com'] };
    expect(recipientsForAlert(config, 'pool80')).toEqual(operators);
  });

  test('readBillingConfig parses BILLING_CLIENT_EMAILS and keeps it out of reconcile', () => {
    const config = readBillingConfig({
      BILLING_INTERNAL_TOKEN: 'secret',
      BILLING_OPERATOR_EMAILS: 'Ops@Example.com',
      BILLING_CLIENT_EMAILS: ' Coordinator@Client.example , ',
    } as NodeJS.ProcessEnv);
    expect(config.clientEmails).toEqual(['coordinator@client.example']);
    expect(recipientsForAlert(config, 'pool80')).toEqual([
      'ops@example.com',
      'coordinator@client.example',
    ]);
    expect(recipientsForAlert(config, 'reconcile')).toEqual(['ops@example.com']);
  });

  test('unset BILLING_CLIENT_EMAILS leaves an empty list, not undefined', () => {
    const config = readBillingConfig({ BILLING_INTERNAL_TOKEN: 'secret' } as NodeJS.ProcessEnv);
    expect(config.clientEmails).toEqual([]);
  });
});
