import { logger } from '@librechat/data-schemas';
import { createOpenRouterManagement } from './openrouter';

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
