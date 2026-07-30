import type { Response } from 'express';
import type { AuthenticatedRequest } from './handlers';
import { createApiKeyHandlers, resolveApiKeyExpiry } from './handlers';

const DAY = 24 * 60 * 60 * 1000;
const YEAR = 365 * DAY;
const NOW = Date.UTC(2026, 6, 28, 12, 0, 0);

describe('resolveApiKeyExpiry', () => {
  it('caps an unbounded key at a year rather than minting it forever', () => {
    expect(resolveApiKeyExpiry(null, NOW)).toEqual({ expiresAt: new Date(NOW + YEAR) });
    expect(resolveApiKeyExpiry(undefined, NOW)).toEqual({ expiresAt: new Date(NOW + YEAR) });
    expect(resolveApiKeyExpiry('', NOW)).toEqual({ expiresAt: new Date(NOW + YEAR) });
  });

  it('keeps a shorter expiry the caller asked for', () => {
    const requested = new Date(NOW + 30 * DAY).toISOString();
    expect(resolveApiKeyExpiry(requested, NOW)).toEqual({ expiresAt: new Date(requested) });
  });

  it('clamps an expiry past the ceiling', () => {
    const requested = new Date(NOW + 10 * YEAR).toISOString();
    expect(resolveApiKeyExpiry(requested, NOW)).toEqual({ expiresAt: new Date(NOW + YEAR) });
  });

  it('rejects input that is not a usable date instead of storing Invalid Date', () => {
    // `new Date('whenever')` is Invalid Date, which reached mongoose as a cast error → 500.
    expect(resolveApiKeyExpiry('whenever', NOW)).toEqual({
      error: 'expiresAt must be a valid date',
    });
    expect(resolveApiKeyExpiry({}, NOW)).toEqual({ error: 'expiresAt must be a date' });
  });

  it('rejects an expiry in the past', () => {
    const requested = new Date(NOW - DAY).toISOString();
    expect(resolveApiKeyExpiry(requested, NOW)).toEqual({
      error: 'expiresAt must be in the future',
    });
  });
});

describe('createApiKey handler', () => {
  const buildRes = () => {
    const res = {
      statusCode: 0,
      body: undefined as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.body = payload;
        return this;
      },
    };
    return res as unknown as Response & { statusCode: number; body: Record<string, unknown> };
  };

  const buildDeps = () => ({
    createAgentApiKey: jest.fn().mockResolvedValue({
      id: 'key_1',
      name: 'ci',
      key: 'sk-secret',
      keyPrefix: 'sk-se',
      createdAt: new Date(NOW),
      expiresAt: new Date(NOW + YEAR),
    }),
    listAgentApiKeys: jest.fn(),
    deleteAgentApiKey: jest.fn(),
    getAgentApiKeyById: jest.fn(),
  });

  it('bounds a key created without an expiry', async () => {
    const deps = buildDeps();
    const { createApiKey } = createApiKeyHandlers(deps);
    const req = { body: { name: 'ci' }, user: { id: 'u1' } } as unknown as AuthenticatedRequest;

    await createApiKey(req, buildRes());

    const passed = deps.createAgentApiKey.mock.calls[0][0].expiresAt as Date;
    expect(passed).toBeInstanceOf(Date);
    expect(passed.getTime()).toBeGreaterThan(Date.now());
    expect(passed.getTime()).toBeLessThanOrEqual(Date.now() + YEAR + 1000);
  });

  it('answers 400 for an unparseable expiry instead of failing in the database', async () => {
    const deps = buildDeps();
    const { createApiKey } = createApiKeyHandlers(deps);
    const req = {
      body: { name: 'ci', expiresAt: 'soon' },
      user: { id: 'u1' },
    } as unknown as AuthenticatedRequest;
    const res = buildRes();

    await createApiKey(req, res);

    expect(res.statusCode).toBe(400);
    expect(deps.createAgentApiKey).not.toHaveBeenCalled();
  });

  it('exposes the minted key id so the audit entry can name it', async () => {
    const deps = buildDeps();
    const { createApiKey } = createApiKeyHandlers(deps);
    const req = { body: { name: 'ci' }, user: { id: 'u1' } } as unknown as AuthenticatedRequest;

    await createApiKey(req, buildRes());

    // POST has no `:id` param, so without this the trail recorded a nameless key.
    expect(req.auditApiKeyId).toBe('key_1');
  });
});
