const { clampEnvInt } = require('./fileSearch');

describe('clampEnvInt — FILE_SEARCH_* bounds (E-M1)', () => {
  it('returns the fallback for missing / non-numeric / non-positive input', () => {
    expect(clampEnvInt(undefined, 12, 50)).toBe(12);
    expect(clampEnvInt('', 12, 50)).toBe(12);
    expect(clampEnvInt('abc', 12, 50)).toBe(12);
    expect(clampEnvInt('0', 12, 50)).toBe(12);
    expect(clampEnvInt('-5', 12, 50)).toBe(12);
  });

  it('passes through an in-range value', () => {
    expect(clampEnvInt('20', 12, 50)).toBe(20);
    expect(clampEnvInt('50', 12, 50)).toBe(50);
  });

  it('clamps an over-limit value to max (e.g. FILE_SEARCH_K=2000 → 50)', () => {
    expect(clampEnvInt('2000', 12, 50)).toBe(50);
    expect(clampEnvInt('5000', 20, 100)).toBe(100);
  });
});
