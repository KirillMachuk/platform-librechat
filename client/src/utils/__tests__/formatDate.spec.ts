import i18n from '~/locales/i18n';
import { formatDate, formatTimestamp } from '../files';

/**
 * Dates must follow the language chosen in the app, not the browser's. The old
 * helper hardcoded 'en-US' plus an English month array, which is why four screens
 * cloned their own formatter instead of importing it — so the guarantee worth
 * pinning is "switch the app language, get a different string".
 */

const AUG_2026 = '2026-08-14T09:05:00.000Z';

describe('formatDate', () => {
  const original = i18n.language;

  afterEach(() => {
    i18n.language = original;
  });

  it('follows the app language, not the browser', () => {
    i18n.language = 'en';
    const english = formatDate(AUG_2026);
    i18n.language = 'ru';
    const russian = formatDate(AUG_2026);

    expect(english).not.toBe(russian);
    // Guards the specific regression: an English month name for a Russian user.
    expect(russian).not.toMatch(/Aug/);
    expect(english).toMatch(/Aug/);
  });

  it('renders nothing rather than throwing on unusable input', () => {
    // Intl.format raises RangeError on an invalid date, and these call sites feed
    // it straight from the API, so a bad value must degrade instead of crashing.
    expect(formatDate(undefined)).toBe('');
    expect(formatDate(null)).toBe('');
    expect(formatDate('')).toBe('');
    expect(formatDate('not a date')).toBe('');
    expect(formatTimestamp('not a date')).toBe('');
  });

  it('accepts the shapes the call sites actually hold', () => {
    const asDate = new Date(AUG_2026);
    expect(formatDate(asDate)).toBe(formatDate(AUG_2026));
    expect(formatTimestamp(asDate)).toBe(formatTimestamp(AUG_2026));
  });

  it('keeps the compact variant for narrow screens', () => {
    i18n.language = 'en';
    expect(formatDate(AUG_2026, true)).not.toBe(formatDate(AUG_2026, false));
  });

  it('formatTimestamp carries the time, formatDate does not', () => {
    i18n.language = 'en';
    expect(formatTimestamp(AUG_2026)).toMatch(/\d{1,2}:\d{2}/);
    expect(formatDate(AUG_2026)).not.toMatch(/\d{1,2}:\d{2}/);
  });
});
