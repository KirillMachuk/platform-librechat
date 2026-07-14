import { readBillingConfig } from './config';

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
