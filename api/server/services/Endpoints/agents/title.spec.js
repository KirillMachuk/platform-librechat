const { resolveTitleTimeoutMs } = require('./title');

describe('resolveTitleTimeoutMs (E-M4)', () => {
  const original = process.env.TITLE_GENERATION_TIMEOUT_MS;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.TITLE_GENERATION_TIMEOUT_MS;
    } else {
      process.env.TITLE_GENERATION_TIMEOUT_MS = original;
    }
  });

  it('defaults to 45s for a non-reasoning title model', () => {
    delete process.env.TITLE_GENERATION_TIMEOUT_MS;
    expect(resolveTitleTimeoutMs('anthropic/claude-sonnet-4.6')).toBe(45000);
    expect(resolveTitleTimeoutMs(undefined)).toBe(45000);
  });

  it('uses a longer default for a reasoning title model', () => {
    delete process.env.TITLE_GENERATION_TIMEOUT_MS;
    expect(resolveTitleTimeoutMs('openai/gpt-5')).toBe(120000);
    expect(resolveTitleTimeoutMs('openai/gpt-5.4-mini')).toBe(120000);
  });

  it('honors a valid env override (clamped to the safe range)', () => {
    process.env.TITLE_GENERATION_TIMEOUT_MS = '90000';
    expect(resolveTitleTimeoutMs('anthropic/claude-sonnet-4.6')).toBe(90000);
    // env wins even for a reasoning model
    expect(resolveTitleTimeoutMs('openai/gpt-5')).toBe(90000);
  });

  it('clamps an out-of-range env override', () => {
    process.env.TITLE_GENERATION_TIMEOUT_MS = '5000';
    expect(resolveTitleTimeoutMs(undefined)).toBe(15000);
    process.env.TITLE_GENERATION_TIMEOUT_MS = '999999';
    expect(resolveTitleTimeoutMs(undefined)).toBe(300000);
  });

  it('ignores a non-numeric or non-positive env override', () => {
    process.env.TITLE_GENERATION_TIMEOUT_MS = 'not-a-number';
    expect(resolveTitleTimeoutMs('openai/gpt-5')).toBe(120000);
    process.env.TITLE_GENERATION_TIMEOUT_MS = '0';
    expect(resolveTitleTimeoutMs('anthropic/claude-sonnet-4.6')).toBe(45000);
  });
});
