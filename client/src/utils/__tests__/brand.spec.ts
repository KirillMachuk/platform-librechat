import { resolveAppTitle, BRAND_NAME } from '../brand';

/**
 * This is a white-label fork, so the upstream name must never reach a user. It
 * can arrive from an unset APP_TITLE on the server, from a config file nobody
 * edited, or from localStorage written by an older build — hence one guard
 * rather than a ternary repeated at each display site.
 */
describe('resolveAppTitle', () => {
  it('replaces the upstream name', () => {
    expect(resolveAppTitle('LibreChat')).toBe(BRAND_NAME);
  });

  it('falls back to our brand when nothing is configured', () => {
    expect(resolveAppTitle(undefined)).toBe(BRAND_NAME);
    expect(resolveAppTitle(null)).toBe(BRAND_NAME);
    expect(resolveAppTitle('')).toBe(BRAND_NAME);
  });

  it('keeps a title the operator actually chose', () => {
    // A client running their own name must not be overwritten by ours.
    expect(resolveAppTitle('Юридический ассистент')).toBe('Юридический ассистент');
  });
});
