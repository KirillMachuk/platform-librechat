import axios from 'axios';
import { logger } from '@librechat/data-schemas';
import {
  extractCapabilities,
  extractModelCapabilities,
  fetchModelCapabilities,
} from './modelCapabilities';

jest.mock('axios');
jest.mock('@librechat/data-schemas', () => ({
  logger: { warn: jest.fn(), debug: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

/** `mock`-prefixed so the hoisted `jest.mock` factory below may reference them. */
const mockCacheStore = new Map<string, { value: unknown; ttl?: number }>();
const mockCacheGet = jest.fn(async (key: string) => mockCacheStore.get(key)?.value);
const mockCacheSet = jest.fn(async (key: string, value: unknown, ttl?: number) => {
  mockCacheStore.set(key, { value, ttl });
  return true;
});

jest.mock('~/cache', () => ({
  standardCache: () => ({ get: mockCacheGet, set: mockCacheSet }),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const cacheSet = mockCacheSet;

beforeEach(() => {
  mockCacheStore.clear();
  jest.clearAllMocks();
});

/**
 * The point of reading capabilities off the gateway is that nobody has to edit a
 * list when the model line-up changes — so the parser has to be tolerant of
 * entries it does not understand rather than throwing the whole answer away.
 */
describe('extractModelCapabilities', () => {
  it('reads modalities, tools and window from a catalogue entry', () => {
    const payload = {
      data: [
        {
          id: 'anthropic/claude-sonnet-5',
          context_length: 1000000,
          architecture: { input_modalities: ['text', 'image', 'file'] },
          supported_parameters: ['tools', 'reasoning'],
          top_provider: { context_length: 1000000, max_completion_tokens: 128000 },
        },
      ],
    };

    expect(extractModelCapabilities(payload)).toEqual({
      'anthropic/claude-sonnet-5': {
        vision: true,
        tools: true,
        contextTokens: 1000000,
        maxOutputTokens: 128000,
      },
    });
  });

  /** A model added upstream tomorrow is classified with no code change. */
  it('classifies a model the code has never heard of', () => {
    const payload = {
      data: [
        {
          id: 'vendor/model-from-the-future',
          architecture: { input_modalities: ['image'] },
          supported_parameters: ['tools'],
        },
      ],
    };

    expect(extractModelCapabilities(payload)['vendor/model-from-the-future']).toEqual({
      vision: true,
      tools: true,
      contextTokens: undefined,
      maxOutputTokens: undefined,
    });
  });

  /** 17% of the catalogue cannot call tools; web search and agents need them. */
  it('reports a model that cannot call tools', () => {
    const payload = {
      data: [{ id: 'vendor/chat-only', supported_parameters: ['temperature', 'max_tokens'] }],
    };

    expect(extractModelCapabilities(payload)['vendor/chat-only'].tools).toBe(false);
  });

  it('keeps a model with no metadata, so "unknown" differs from "not served"', () => {
    const payload = { data: [{ id: 'vendor/bare' }] };
    const result = extractModelCapabilities(payload);

    expect(result).toHaveProperty('vendor/bare');
    expect(result['vendor/bare']).toEqual({
      vision: undefined,
      tools: undefined,
      contextTokens: undefined,
      maxOutputTokens: undefined,
    });
  });

  it('skips entries without a usable id instead of failing', () => {
    const payload = {
      data: [
        { architecture: { input_modalities: ['image'] } },
        { id: '' },
        { id: 42 },
        null,
        { id: 'good/one', architecture: { input_modalities: ['image'] } },
      ],
    };

    expect(Object.keys(extractModelCapabilities(payload))).toEqual(['good/one']);
  });

  it('answers empty for a shape it does not recognise', () => {
    expect(extractModelCapabilities(undefined)).toEqual({});
    expect(extractModelCapabilities(null)).toEqual({});
    expect(extractModelCapabilities({})).toEqual({});
    expect(extractModelCapabilities({ data: 'not an array' })).toEqual({});
    expect(extractModelCapabilities('nonsense')).toEqual({});
  });
});

describe('extractCapabilities: context window', () => {
  /**
   * Overstating the window is the harmful direction — the provider rejects the
   * request outright, whereas understating it only trims history early.
   */
  it('takes the smaller of the model and the serving provider figures', () => {
    expect(
      extractCapabilities({
        context_length: 1000000,
        top_provider: { context_length: 200000 },
      }).contextTokens,
    ).toBe(200000);
  });

  it('uses whichever single figure is present', () => {
    expect(extractCapabilities({ context_length: 163840 }).contextTokens).toBe(163840);
    expect(extractCapabilities({ top_provider: { context_length: 65536 } }).contextTokens).toBe(
      65536,
    );
  });

  it('rejects non-integer, zero and stringly-typed figures', () => {
    expect(extractCapabilities({ context_length: '128000' }).contextTokens).toBeUndefined();
    expect(extractCapabilities({ context_length: 0 }).contextTokens).toBeUndefined();
    expect(extractCapabilities({ context_length: -1 }).contextTokens).toBeUndefined();
    expect(extractCapabilities({ context_length: 1.5 }).contextTokens).toBeUndefined();
    expect(extractCapabilities({ context_length: null }).contextTokens).toBeUndefined();
  });

  it('distinguishes "no such field" from "false"', () => {
    expect(extractCapabilities({ id: 'x' }).vision).toBeUndefined();
    expect(extractCapabilities({ architecture: { input_modalities: ['text'] } }).vision).toBe(false);
    expect(extractCapabilities({ architecture: { input_modalities: 'image' } }).vision).toBeUndefined();
  });
});

describe('fetchModelCapabilities', () => {
  const args = { baseURL: 'http://gateway.internal/v1', apiKey: 'k' };
  const cacheKey = 'capabilities:http://gateway.internal/v1';

  const catalogue = {
    data: [
      {
        id: 'a/model',
        context_length: 128000,
        architecture: { input_modalities: ['text', 'image'] },
        supported_parameters: ['tools'],
      },
    ],
  };

  it('asks the gateway once and reuses the answer for an hour', async () => {
    mockedAxios.get.mockResolvedValue({ data: catalogue });

    const first = await fetchModelCapabilities(args);
    const second = await fetchModelCapabilities(args);

    expect(first).toEqual(second);
    expect(first['a/model'].vision).toBe(true);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    expect(cacheSet).toHaveBeenCalledWith(cacheKey, expect.any(Object), 3600000);
  });

  /**
   * Load-bearing: the endpoints config is rebuilt on the message path, so an
   * uncached empty answer is an HTTP round trip per message — and up to the
   * request timeout of added latency per message when the route hangs.
   */
  it('remembers an empty answer briefly instead of re-asking every time', async () => {
    mockedAxios.get.mockResolvedValue({ data: { data: [] } });

    expect(await fetchModelCapabilities(args)).toEqual({});
    expect(await fetchModelCapabilities(args)).toEqual({});

    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    expect(cacheSet).toHaveBeenCalledWith(cacheKey, {}, 120000);
  });

  it('remembers a failing gateway briefly rather than retrying on every message', async () => {
    mockedAxios.get.mockRejectedValue(new Error('ECONNREFUSED'));

    expect(await fetchModelCapabilities(args)).toEqual({});
    expect(await fetchModelCapabilities(args)).toEqual({});

    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    expect(cacheSet).toHaveBeenCalledWith(cacheKey, {}, 120000);
  });

  it('caps how long it waits for the gateway', async () => {
    mockedAxios.get.mockResolvedValue({ data: catalogue });
    await fetchModelCapabilities(args);

    expect(mockedAxios.get).toHaveBeenCalledWith(
      'http://gateway.internal/v1/models',
      expect.objectContaining({ timeout: 5000 }),
    );
  });

  /** A rolling deploy must not read the previous revision's `string[]` values. */
  it('ignores a cached value of the wrong shape', async () => {
    mockCacheStore.set(cacheKey, { value: ['a/model'] });
    mockedAxios.get.mockResolvedValue({ data: catalogue });

    expect(await fetchModelCapabilities(args)).toEqual({
      'a/model': {
        vision: true,
        tools: true,
        contextTokens: 128000,
        maxOutputTokens: undefined,
      },
    });
  });

  it('does not call the gateway without a base URL or key', async () => {
    expect(await fetchModelCapabilities({ apiKey: 'k' })).toEqual({});
    expect(await fetchModelCapabilities({ baseURL: 'http://x/v1' })).toEqual({});
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('survives a cache that throws on read and on write', async () => {
    mockCacheGet.mockRejectedValueOnce(new Error('redis down'));
    mockCacheSet.mockRejectedValueOnce(new Error('redis down'));
    mockedAxios.get.mockResolvedValue({ data: catalogue });

    expect((await fetchModelCapabilities(args))['a/model'].vision).toBe(true);
  });

  describe('configured-model sanity check', () => {
    it('warns about a configured model the gateway does not serve', async () => {
      mockedAxios.get.mockResolvedValue({ data: catalogue });

      await fetchModelCapabilities({ ...args, configuredModels: ['a/model', 'a/typo'] });

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('a/typo'));
      expect(logger.warn).toHaveBeenCalledWith(expect.not.stringContaining('a/model,'));
    });

    it('stays quiet when every configured model is served', async () => {
      mockedAxios.get.mockResolvedValue({ data: catalogue });

      await fetchModelCapabilities({ ...args, configuredModels: ['a/model'] });

      expect(logger.warn).not.toHaveBeenCalled();
    });

    /** Silence beats crying wolf when the gateway published nothing at all. */
    it('stays quiet when the catalogue is empty', async () => {
      mockedAxios.get.mockResolvedValue({ data: { data: [] } });

      await fetchModelCapabilities({ ...args, configuredModels: ['a/model'] });

      expect(logger.warn).not.toHaveBeenCalled();
    });

    /** The check must not run on the message path — only when actually fetched. */
    it('does not re-warn while the answer is cached', async () => {
      mockedAxios.get.mockResolvedValue({ data: catalogue });
      const withTypo = { ...args, configuredModels: ['a/typo'] };

      await fetchModelCapabilities(withTypo);
      await fetchModelCapabilities(withTypo);

      expect(logger.warn).toHaveBeenCalledTimes(1);
    });
  });
});
