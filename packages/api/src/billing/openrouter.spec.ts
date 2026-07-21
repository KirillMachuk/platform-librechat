import { logger } from '@librechat/data-schemas';
import { createOpenRouterManagement, computeKeyLimitUsd } from './openrouter';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

function mgmt(fetchImpl: jest.Mock) {
  return createOpenRouterManagement({
    managementKey: 'mk-1',
    keyHash: 'hash-1',
    baseUrl: 'https://openrouter.ai/api/v1',
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
}

describe('createOpenRouterManagement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reports unconfigured without a management key or key hash', () => {
    expect(createOpenRouterManagement({}).isConfigured).toBe(false);
  });

  it('maps a well-formed key payload and does not warn', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        jsonResponse({ data: { limit: 300, usage: 120, usage_monthly: 42, disabled: false } }),
      );

    const info = await mgmt(fetchImpl).getKey();

    expect(info).toMatchObject({
      limitUsd: 300,
      usageUsd: 120,
      usageMonthlyUsd: 42,
      disabled: false,
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('warns and degrades to all-null on an unexpected response shape', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ unexpected: true }));

    const info = await mgmt(fetchImpl).getKey();

    expect(info).toMatchObject({
      limitUsd: null,
      usageUsd: null,
      usageMonthlyUsd: null,
      disabled: false,
    });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('unexpected shape'));
  });

  it('warns when `data` is present but null', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ data: null }));

    const info = await mgmt(fetchImpl).getKey();

    expect(info.usageMonthlyUsd).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('throws on a non-OK key response', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({}, false, 502));

    await expect(mgmt(fetchImpl).getKey()).rejects.toThrow(/502/);
  });

  it('PATCHes the monthly limit with a monthly reset', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ ok: true }));

    await mgmt(fetchImpl).updateLimit(330);

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/keys/hash-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ limit: 330, limit_reset: 'monthly' }),
      }),
    );
  });
});

describe('computeKeyLimitUsd', () => {
  /** $250 pool — the contract default (25 000 Credits). */
  const poolMicroUsd = 250_000_000;

  it('sizes for one pool when billing follows the calendar month (anchor 1)', () => {
    expect(computeKeyLimitUsd({ poolMicroUsd, anchorDay: 1, headroom: 0.1 })).toBe(275);
  });

  it('sizes for TWO pools when the anchor is not the 1st', () => {
    /* The key window is a UTC calendar month while the period is anchor→anchor, so one
     * window holds the tail of one period and the head of the next. A one-pool limit
     * would hard-cut the key mid-contract — this is the regression that matters. */
    expect(computeKeyLimitUsd({ poolMicroUsd, anchorDay: 15, headroom: 0.1 })).toBe(550);
  });

  it('treats a missing anchor as the calendar month and defaults the headroom', () => {
    expect(computeKeyLimitUsd({ poolMicroUsd })).toBe(275);
  });

  it('adds the remaining package balance on top of the worst-case pools', () => {
    expect(
      computeKeyLimitUsd({
        poolMicroUsd,
        packageRemainingMicroUsd: 100_000_000,
        anchorDay: 15,
        headroom: 0.1,
      }),
    ).toBe(660);
  });

  it('ignores a negative package balance (boundary overrun must not lower the fuse)', () => {
    expect(
      computeKeyLimitUsd({
        poolMicroUsd,
        packageRemainingMicroUsd: -50_000_000,
        anchorDay: 1,
        headroom: 0.1,
      }),
    ).toBe(275);
  });
});
