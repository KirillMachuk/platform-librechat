import axios from 'axios';
import crypto from 'node:crypto';
import { logger } from '@librechat/data-schemas';
import type { TEndpointsConfig } from 'librechat-data-provider';
import {
  extractCapabilities,
  reportsNoToolSupport,
  extractModelCapabilities,
  fetchModelCapabilities,
  clearModelCapabilityMemo,
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
  clearModelCapabilityMemo();
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
    expect(extractCapabilities({ architecture: { input_modalities: ['text'] } }).vision).toBe(
      false,
    );
    expect(
      extractCapabilities({ architecture: { input_modalities: 'image' } }).vision,
    ).toBeUndefined();
  });
});

describe('fetchModelCapabilities', () => {
  const args = { baseURL: 'http://gateway.internal/v1', apiKey: 'k' };
  /** Keyed by the whole request identity, so two endpoints on one gateway with
   *  different keys cannot answer for each other. */
  const cacheKey = `capabilities:v2:${crypto
    .createHash('sha256')
    .update(`${args.baseURL}:${args.apiKey}`)
    .digest('hex')
    .slice(0, 32)}`;

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
   * The map outlives the process that parsed it, and a deploy swaps the code
   * without touching the cache. An entry written by the previous parser must be
   * invisible to this one — not read and served for the rest of its hour. That
   * happened on production: the release that added output types spent an hour
   * serving a map without them, and the type filters matched nothing.
   */
  it('does not read a map the previous parser wrote', async () => {
    const unversionedKey = `capabilities:${crypto
      .createHash('sha256')
      .update(`${args.baseURL}:${args.apiKey}`)
      .digest('hex')
      .slice(0, 32)}`;
    mockCacheStore.set(unversionedKey, {
      value: { 'a/model': { vision: true, tools: true } },
    });
    mockedAxios.get.mockResolvedValue({ data: catalogue });

    const result = await fetchModelCapabilities(args);

    /** Answered by a fresh fetch, not by the old entry. */
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    expect(result['a/model'].contextTokens).toBe(128000);
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

  /**
   * The endpoints config is rebuilt several times per request, and a real catalogue
   * is ~38 kB of JSON — without this the same blob is fetched and re-parsed from the
   * shared cache up to eight times to answer one request.
   */
  it('does not re-read the shared cache for the repeats within a request', async () => {
    mockedAxios.get.mockResolvedValue({ data: catalogue });

    await fetchModelCapabilities(args);
    const readsAfterFirst = mockCacheGet.mock.calls.length;
    await fetchModelCapabilities(args);
    await fetchModelCapabilities(args);

    expect(mockCacheGet.mock.calls.length).toBe(readsAfterFirst);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it('holds an empty answer too, so a silent gateway costs nothing either', async () => {
    mockedAxios.get.mockResolvedValue({ data: { data: [] } });

    await fetchModelCapabilities(args);
    const readsAfterFirst = mockCacheGet.mock.calls.length;
    expect(await fetchModelCapabilities(args)).toEqual({});

    expect(mockCacheGet.mock.calls.length).toBe(readsAfterFirst);
  });

  /** Endpoints must not read each other's catalogue. */
  it('keeps what it holds separate per gateway', async () => {
    mockedAxios.get.mockResolvedValue({ data: catalogue });
    await fetchModelCapabilities(args);

    mockedAxios.get.mockResolvedValue({
      data: { data: [{ id: 'b/other', supported_parameters: ['tools'] }] },
    });
    const other = await fetchModelCapabilities({ baseURL: 'http://other/v1', apiKey: 'k' });

    expect(Object.keys(other)).toEqual(['b/other']);
    expect(Object.keys(await fetchModelCapabilities(args))).toEqual(['a/model']);
  });

  it('goes back to the shared cache once what it holds expires', async () => {
    mockedAxios.get.mockResolvedValue({ data: catalogue });
    await fetchModelCapabilities(args);
    const readsAfterFirst = mockCacheGet.mock.calls.length;

    clearModelCapabilityMemo();
    await fetchModelCapabilities(args);

    expect(mockCacheGet.mock.calls.length).toBeGreaterThan(readsAfterFirst);
    /** Served from the shared cache, so still no second trip to the gateway. */
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
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

describe('reportsNoToolSupport', () => {
  const config = {
    gateway: {
      modelCapabilities: {
        'vendor/no-tools': { tools: false },
        'vendor/tools': { tools: true },
        'vendor/silent': {},
      },
    },
  } as unknown as TEndpointsConfig;

  it('answers yes only when the catalogue said no', () => {
    expect(reportsNoToolSupport(config, 'gateway', 'vendor/no-tools')).toBe(true);
    expect(reportsNoToolSupport(config, 'gateway', 'vendor/tools')).toBe(false);
  });

  /**
   * The whole point of the gate failing open: an endpoint whose gateway publishes
   * nothing must behave exactly as it did before the gate existed.
   */
  it('treats every kind of silence as "unknown", never as "no"', () => {
    expect(reportsNoToolSupport(config, 'gateway', 'vendor/silent')).toBe(false);
    expect(reportsNoToolSupport(config, 'gateway', 'vendor/never-heard-of')).toBe(false);
    expect(reportsNoToolSupport(config, 'other-gateway', 'vendor/no-tools')).toBe(false);
    expect(reportsNoToolSupport({} as TEndpointsConfig, 'gateway', 'vendor/no-tools')).toBe(false);
    expect(reportsNoToolSupport(undefined, 'gateway', 'vendor/no-tools')).toBe(false);
    expect(reportsNoToolSupport(config, undefined, 'vendor/no-tools')).toBe(false);
    expect(reportsNoToolSupport(config, 'gateway', undefined)).toBe(false);
  });
});

describe('fetchModelCapabilities: request identity', () => {
  /** Two endpoints on one gateway with different keys serve different models. */
  it('does not answer for a second endpoint that uses a different key', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { data: [{ id: 'cheap/model', supported_parameters: ['tools'] }] },
    });
    mockedAxios.get.mockResolvedValueOnce({
      data: { data: [{ id: 'premium/model', supported_parameters: ['tools'] }] },
    });

    const cheap = await fetchModelCapabilities({ baseURL: 'http://gw/v1', apiKey: 'cheap-key' });
    const premium = await fetchModelCapabilities({
      baseURL: 'http://gw/v1',
      apiKey: 'premium-key',
    });

    expect(Object.keys(cheap)).toEqual(['cheap/model']);
    expect(Object.keys(premium)).toEqual(['premium/model']);
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
  });
});

/**
 * The admin screen labels a model with these, and the owner's one requirement for
 * labels was that they match reality — so each is read from what the catalogue
 * actually publishes, and anything unreadable is dropped rather than guessed.
 */
describe('extractCapabilities: what a model is labelled with', () => {
  it('reads the published name, release date, retirement date and alias target', () => {
    expect(
      extractCapabilities({
        id: '~anthropic/claude-sonnet-latest',
        name: 'Anthropic: Claude Sonnet 5',
        created: 1782843083,
        expiration_date: '2026-08-10',
        alias_target: { slug: 'anthropic/claude-sonnet-5' },
      }),
    ).toEqual(
      expect.objectContaining({
        name: 'Anthropic: Claude Sonnet 5',
        releasedAt: 1782843083,
        retiresOn: '2026-08-10',
        aliasOf: 'anthropic/claude-sonnet-5',
      }),
    );
  });

  it('says nothing about a model the catalogue described plainly', () => {
    expect(extractCapabilities({ id: 'a/plain', context_length: 8000 })).toEqual(
      expect.objectContaining({
        name: undefined,
        releasedAt: undefined,
        retiresOn: undefined,
        aliasOf: undefined,
        free: undefined,
      }),
    );
  });

  /**
   * From the id, never from the price: prices are per unit of the model's own
   * modality, so a model billed per second of audio also reads as zero per token
   * and would be labelled free. `:free` is the catalogue's own marker for it.
   */
  it('marks a free variant from the id', () => {
    expect(extractCapabilities({ id: 'nvidia/nemotron:free' }).free).toBe(true);
    expect(extractCapabilities({ id: 'nvidia/nemotron' }).free).toBeUndefined();
    expect(extractCapabilities({ id: 'a/free-tier' }).free).toBeUndefined();
  });

  /** A deadline in a shape nobody can read is worse than no deadline at all. */
  it('drops a retirement date that is not a calendar date', () => {
    const unusable: unknown[] = ['soon', '2026-13-45', '10.08.2026', 42, null, ''];
    for (const value of unusable) {
      expect(extractCapabilities({ id: 'a/x', expiration_date: value }).retiresOn).toBeUndefined();
    }
  });

  it('drops a release date that is not a positive whole number', () => {
    for (const value of ['1782843083', 0, -5, 1.5, null]) {
      expect(extractCapabilities({ id: 'a/x', created: value }).releasedAt).toBeUndefined();
    }
  });
});

describe('extractCapabilities: what a model is for', () => {
  it('carries the vendor description through', () => {
    expect(
      extractCapabilities({ id: 'a/x', description: 'A frontier model for agentic coding.' })
        .description,
    ).toBe('A frontier model for agentic coding.');
  });

  it('drops a description that is not text', () => {
    for (const value of [42, null, '', '   ', {}, []]) {
      expect(extractCapabilities({ id: 'a/x', description: value }).description).toBeUndefined();
    }
  });

  /** The record is cached and repeated per model, so one field cannot be unbounded. */
  it('bounds a description no upstream limit constrains', () => {
    const description = extractCapabilities({
      id: 'a/x',
      description: 'x'.repeat(5000),
    }).description;
    expect(description).toHaveLength(500);
  });

  /**
   * Every one of these also answers in text, so reading the first entry — or
   * treating `text` as an answer — would call an image generator a text model.
   */
  it('names the distinctive output modality, not the ever-present one', () => {
    const outputOf = (output_modalities: unknown) =>
      extractCapabilities({ id: 'a/x', architecture: { output_modalities } }).outputType;

    expect(outputOf(['text'])).toBe('text');
    expect(outputOf(['image', 'text'])).toBe('image');
    expect(outputOf(['text', 'image'])).toBe('image');
    expect(outputOf(['text', 'audio'])).toBe('audio');
    expect(outputOf(['image', 'audio', 'text'])).toBe('image');
  });

  it('says nothing when the catalogue lists no output modality it knows', () => {
    expect(extractCapabilities({ id: 'a/x' }).outputType).toBeUndefined();
    expect(
      extractCapabilities({ id: 'a/x', architecture: { output_modalities: 'text' } }).outputType,
    ).toBeUndefined();
    expect(
      extractCapabilities({ id: 'a/x', architecture: { output_modalities: ['embeddings'] } })
        .outputType,
    ).toBeUndefined();
  });

  it('reads the intelligence index the catalogue republishes', () => {
    expect(
      extractCapabilities({
        id: 'a/x',
        benchmarks: { artificial_analysis: { intelligence_index: 57.1 } },
      }).intelligence,
    ).toBe(57.1);
  });

  it('says nothing about intelligence rather than guessing a zero', () => {
    expect(extractCapabilities({ id: 'a/x' }).intelligence).toBeUndefined();
    expect(extractCapabilities({ id: 'a/x', benchmarks: {} }).intelligence).toBeUndefined();
    /** A negative index is not a score, and a missing one must not sort as the worst. */
    for (const value of [null, -1, NaN, 'strong', '']) {
      expect(
        extractCapabilities({
          id: 'a/x',
          benchmarks: { artificial_analysis: { intelligence_index: value } },
        }).intelligence,
      ).toBeUndefined();
    }
  });

  /** Read the same way prices are, which the catalogue publishes as strings. */
  it('accepts an index published as a numeric string', () => {
    expect(
      extractCapabilities({
        id: 'a/x',
        benchmarks: { artificial_analysis: { intelligence_index: '57.1' } },
      }).intelligence,
    ).toBe(57.1);
  });
});

/**
 * The band is what an operator is shown instead of a price, so the cases that
 * matter are the ones where a number exists but does not mean what it looks like.
 */
describe('extractCapabilities: cost band', () => {
  const bandOf = (prompt: unknown, completion: unknown, output_modalities: unknown = ['text']) =>
    extractCapabilities({
      id: 'a/x',
      pricing: { prompt, completion },
      architecture: { output_modalities },
    });

  /** Prices as this stand's own line-up publishes them. */
  it('puts the models this stand runs where an operator would put them', () => {
    expect(bandOf('0.00000025', '0.00000095').priceTier).toBe('economy'); // DeepSeek V3.1
    expect(bandOf('0.00000112', '0.00000352').priceTier).toBe('standard'); // GLM 5.2
    expect(bandOf('0.000002', '0.00001').priceTier).toBe('premium'); // Claude Sonnet 5
    expect(bandOf('0.000005', '0.000025').priceTier).toBe('top'); // Claude Opus 5
  });

  it('cuts at the published boundaries, upper edge exclusive', () => {
    expect(bandOf('0', '0.0000039').priceTier).toBe('economy'); // 0.975
    expect(bandOf('0', '0.000004').priceTier).toBe('standard'); // 1.000
    expect(bandOf('0', '0.0000119').priceTier).toBe('standard'); // 2.975
    expect(bandOf('0', '0.000012').priceTier).toBe('premium'); // 3.000
    expect(bandOf('0', '0.0000319').priceTier).toBe('premium'); // 7.975
    expect(bandOf('0', '0.000032').priceTier).toBe('top'); // 8.000
  });

  it('reports the blend it cut from, weighted toward input', () => {
    /** Sonnet 5: (3 × 2 + 10) / 4 = 4 USD per million. */
    expect(bandOf('0.000002', '0.00001').priceBlend).toBe(4);
    /** Equal weighting would have said 6. */
    expect(bandOf('0.000002', '0.00001').priceBlend).not.toBe(6);
  });

  /**
   * `openrouter/auto` publishes -1 because its price is whatever it routes to.
   * Read as a number it is below every ceiling, so the router would be labelled
   * the cheapest thing in the catalogue.
   */
  it('refuses to band a router that has no price of its own', () => {
    expect(bandOf('-1', '-1').priceTier).toBeUndefined();
    expect(bandOf('-1', '-1').priceBlend).toBeUndefined();
  });

  /**
   * Today's sentinel is -1 per token, which is enormous next to a real price and
   * drags the blend negative on its own. A smaller negative would not: it averages
   * back above zero and would come out as an ordinary band. Refusing negative
   * prices outright is what covers both, rather than relying on the sentinel
   * staying large.
   */
  it('refuses a negative price too small to drag the blend below zero', () => {
    /** Blends to +2.425, comfortably inside a band, from a nonsense input price. */
    expect(bandOf('-0.0000001', '0.00001').priceTier).toBeUndefined();
    expect(bandOf('0.000002', '-0.0000001').priceTier).toBeUndefined();
  });

  it('refuses to band a model nobody is charged per token for', () => {
    /** A free variant. */
    expect(bandOf('0', '0').priceTier).toBeUndefined();
    /** Billed per second of audio; its token prices are zero. */
    expect(bandOf('0', '0', ['text', 'audio']).priceTier).toBeUndefined();
    /** Billed per image on top of tokens, so the token blend understates it. */
    expect(bandOf('0.000002', '0.000012', ['image', 'text']).priceTier).toBeUndefined();
  });

  it('says nothing when the catalogue published no price', () => {
    expect(extractCapabilities({ id: 'a/x' }).priceTier).toBeUndefined();
    expect(bandOf(undefined, '0.00001').priceTier).toBeUndefined();
    expect(bandOf('0.000002', undefined).priceTier).toBeUndefined();
    /** `Number('')` is 0, which would read as free rather than as absent. */
    expect(bandOf('', '').priceTier).toBeUndefined();
    expect(bandOf('cheap', 'dear').priceTier).toBeUndefined();
  });

  /** A model with no stated output modality is not assumed to answer in text. */
  it('does not band a model whose output the catalogue did not name', () => {
    expect(
      extractCapabilities({ id: 'a/x', pricing: { prompt: '0.000002', completion: '0.00001' } })
        .priceTier,
    ).toBeUndefined();
  });
});
