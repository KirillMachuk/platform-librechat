import { PrincipalType } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { AdminModelEndpoint } from './modelCatalogue';
import type { ServerRequest } from '~/types/http';
import {
  createModelCatalogueHandlers,
  collectModelRoles,
  mergeEndpointOverride,
} from './modelCatalogue';

jest.mock('@librechat/data-schemas', () => ({
  logger: { warn: jest.fn(), debug: jest.fn(), error: jest.fn(), info: jest.fn() },
  BASE_CONFIG_PRINCIPAL_ID: 'base',
}));

const CATALOGUE = {
  'a/enabled': { vision: true, tools: true, contextTokens: 1000000, maxOutputTokens: 128000 },
  'a/also-enabled': { vision: false, tools: true, contextTokens: 163840 },
  'a/available': { vision: true, tools: false, contextTokens: 8000 },
};

function appConfig(overrides: Record<string, unknown> = {}): AppConfig {
  return {
    endpoints: {
      custom: [
        {
          name: 'gw',
          baseURL: 'http://gw/v1',
          apiKey: 'k',
          models: { default: ['a/enabled', 'a/also-enabled'] },
        },
      ],
    },
    ...overrides,
  } as unknown as AppConfig;
}

function fakeRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res as unknown as Response & {
    statusCode: number;
    /** What the handlers actually answer, so the assertions below are type-checked. */
    body: { endpoints: AdminModelEndpoint[]; error?: string };
  };
}

/**
 * Reads one model out of an answer, failing with its id when it is missing —
 * `.find()` on its own hands back `undefined` and the assertion then blames the
 * wrong thing.
 */
const modelById = (models: AdminModelEndpoint['models'], id: string) => {
  const found = models.find((model) => model.id === id);
  if (!found) {
    throw new Error(`the answer carries no model "${id}"`);
  }
  return found;
};

const fakeReq = () => ({ user: { id: 'u1', role: 'ADMIN' }, body: {} }) as unknown as ServerRequest;

function createDeps(overrides: Record<string, unknown> = {}) {
  return {
    getAppConfig: jest.fn().mockResolvedValue(appConfig()),
    fetchModelCapabilities: jest.fn().mockResolvedValue(CATALOGUE),
    countAgentsByModel: jest.fn().mockResolvedValue({}),
    findConfigByPrincipal: jest.fn().mockResolvedValue(null),
    patchConfigFields: jest.fn().mockResolvedValue(undefined),
    invalidateConfigCaches: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const put = async (body: unknown, overrides: Record<string, unknown> = {}) => {
  const deps = createDeps(overrides);
  const { setModels } = createModelCatalogueHandlers(deps as never);
  const res = fakeRes();
  await setModels({ ...fakeReq(), body } as ServerRequest, res);
  return { res, deps };
};

describe('getCatalogue', () => {
  it('lists the whole catalogue with the configured models marked enabled', async () => {
    const { getCatalogue } = createModelCatalogueHandlers(createDeps() as never);
    const res = fakeRes();

    await getCatalogue(fakeReq(), res);

    expect(res.statusCode).toBe(200);
    const endpoint = res.body.endpoints[0];
    expect(endpoint.name).toBe('gw');
    expect(endpoint.source).toBe('catalogue');
    expect(endpoint.models.map((m: { id: string }) => m.id)).toEqual([
      'a/enabled',
      'a/also-enabled',
      'a/available',
    ]);
    expect(endpoint.models.map((m: { enabled: boolean }) => m.enabled)).toEqual([
      true,
      true,
      false,
    ]);
  });

  it('carries the capability badges the screen needs', async () => {
    const { getCatalogue } = createModelCatalogueHandlers(createDeps() as never);
    const res = fakeRes();

    await getCatalogue(fakeReq(), res);

    expect(res.body.endpoints[0].models[0]).toEqual(
      expect.objectContaining({
        id: 'a/enabled',
        vision: true,
        tools: true,
        contextTokens: 1000000,
        maxOutputTokens: 128000,
      }),
    );
  });

  /** 17% of a real catalogue cannot call tools; web search and agents need them. */
  it('reports a model that cannot call tools', async () => {
    const { getCatalogue } = createModelCatalogueHandlers(createDeps() as never);
    const res = fakeRes();

    await getCatalogue(fakeReq(), res);

    expect(modelById(res.body.endpoints[0].models, 'a/available').tools).toBe(false);
  });

  it('counts the agents pinned to each model', async () => {
    const deps = createDeps({
      countAgentsByModel: jest.fn().mockResolvedValue({ 'a/enabled': 7 }),
    });
    const { getCatalogue } = createModelCatalogueHandlers(deps as never);
    const res = fakeRes();

    await getCatalogue(fakeReq(), res);

    const models = res.body.endpoints[0].models;
    expect(modelById(models, 'a/enabled').agents).toBe(7);
    expect(modelById(models, 'a/also-enabled').agents).toBe(0);
  });

  /**
   * Losing the gateway must leave a usable screen rather than an empty one, and it
   * must not claim the catalogue is the whole world — a typo is indistinguishable
   * from a model the gateway simply did not mention.
   */
  it('falls back to the configured list when the gateway publishes nothing', async () => {
    const deps = createDeps({ fetchModelCapabilities: jest.fn().mockResolvedValue({}) });
    const { getCatalogue } = createModelCatalogueHandlers(deps as never);
    const res = fakeRes();

    await getCatalogue(fakeReq(), res);

    const endpoint = res.body.endpoints[0];
    expect(endpoint.source).toBe('config');
    expect(endpoint.models.map((m: { id: string }) => m.id)).toEqual([
      'a/enabled',
      'a/also-enabled',
    ]);
    expect(endpoint.models.every((m: { enabled: boolean }) => m.enabled)).toBe(true);
  });

  /** The state an operator most needs to see: offered, but the gateway denies it. */
  it('keeps a configured model the catalogue does not list, still marked enabled', async () => {
    const deps = createDeps({
      getAppConfig: jest.fn().mockResolvedValue(
        appConfig({
          endpoints: {
            custom: [
              {
                name: 'gw',
                baseURL: 'http://gw/v1',
                apiKey: 'k',
                models: { default: ['a/enabled', 'a/typo'] },
              },
            ],
          },
        }),
      ),
    });
    const { getCatalogue } = createModelCatalogueHandlers(deps as never);
    const res = fakeRes();

    await getCatalogue(fakeReq(), res);

    const typo = modelById(res.body.endpoints[0].models, 'a/typo');
    expect(typo.enabled).toBe(true);
    /** No capability badges: the catalogue said nothing about it. */
    expect(typo.tools).toBeUndefined();
    expect(typo.contextTokens).toBeUndefined();
  });

  it('answers 500 rather than throwing when the config cannot be read', async () => {
    const deps = createDeps({ getAppConfig: jest.fn().mockRejectedValue(new Error('mongo down')) });
    const { getCatalogue } = createModelCatalogueHandlers(deps as never);
    const res = fakeRes();

    await getCatalogue(fakeReq(), res);

    expect(res.statusCode).toBe(500);
  });
});

describe('setModels', () => {
  it('writes the list as an endpoint override and refreshes caches', async () => {
    const { res, deps } = await put({ endpoint: 'gw', models: ['a/enabled', 'a/available'] });

    expect(res.statusCode).toBe(200);
    expect(deps.patchConfigFields).toHaveBeenCalledWith(
      PrincipalType.ROLE,
      'base',
      expect.anything(),
      { 'endpoints.custom': [{ name: 'gw', models: { default: ['a/enabled', 'a/available'] } }] },
      10,
    );
    expect(deps.invalidateConfigCaches).toHaveBeenCalled();
  });

  it('preserves the order it was given — the first model is the chat fallback', async () => {
    const { deps } = await put({ endpoint: 'gw', models: ['a/available', 'a/enabled'] });

    expect(deps.patchConfigFields.mock.calls[0][3]['endpoints.custom'][0].models.default).toEqual([
      'a/available',
      'a/enabled',
    ]);
  });

  /**
   * An empty list is refused rather than accepted-and-guarded-on-read: the merged
   * config would carry `[]` and nobody could start a chat.
   */
  it('refuses to leave the endpoint with no models', async () => {
    const { res, deps } = await put({ endpoint: 'gw', models: [] });

    expect(res.statusCode).toBe(400);
    expect(deps.patchConfigFields).not.toHaveBeenCalled();
  });

  it('rejects a model the gateway does not serve', async () => {
    const { res, deps } = await put({ endpoint: 'gw', models: ['a/enabled', 'a/nonsense'] });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('a/nonsense');
    expect(deps.patchConfigFields).not.toHaveBeenCalled();
  });

  /** Without a catalogue every id would look invalid and the endpoint unmanageable. */
  it('skips catalogue validation when the gateway publishes nothing', async () => {
    const { res } = await put(
      { endpoint: 'gw', models: ['a/enabled', 'anything/at-all'] },
      { fetchModelCapabilities: jest.fn().mockResolvedValue({}) },
    );

    expect(res.statusCode).toBe(200);
  });

  it('rejects an unknown endpoint, a missing endpoint and a bad list', async () => {
    expect((await put({ endpoint: 'nope', models: ['a/enabled'] })).res.statusCode).toBe(400);
    expect((await put({ models: ['a/enabled'] })).res.statusCode).toBe(400);
    expect((await put({ endpoint: 'gw', models: 'a/enabled' })).res.statusCode).toBe(400);
    expect((await put({ endpoint: 'gw', models: [''] })).res.statusCode).toBe(400);
    expect((await put({ endpoint: 'gw' })).res.statusCode).toBe(400);
  });

  it('rejects a repeated model', async () => {
    const { res } = await put({ endpoint: 'gw', models: ['a/enabled', 'a/enabled'] });

    expect(res.statusCode).toBe(400);
  });

  /**
   * The list is persisted, echoed into every audit entry and delivered to every
   * client with the endpoints config — an oversized request would inflate all
   * three at once, so it is refused before any of that happens.
   */
  describe('blast-radius ceilings', () => {
    it('rejects a list longer than any real catalogue', async () => {
      const { res, deps } = await put({
        endpoint: 'gw',
        models: Array.from({ length: 1001 }, (_, i) => `a/model-${i}`),
      });

      expect(res.statusCode).toBe(400);
      expect(deps.patchConfigFields).not.toHaveBeenCalled();
    });

    it('rejects an absurdly long model id', async () => {
      const { res, deps } = await put({ endpoint: 'gw', models: ['a/'.padEnd(201, 'x')] });

      expect(res.statusCode).toBe(400);
      expect(deps.patchConfigFields).not.toHaveBeenCalled();
    });

    it('still accepts a full real catalogue', async () => {
      const many = Array.from({ length: 400 }, (_, i) => `a/model-${i}`);
      const { res } = await put(
        { endpoint: 'gw', models: many },
        { fetchModelCapabilities: jest.fn().mockResolvedValue({}) },
      );

      expect(res.statusCode).toBe(200);
    });
  });

  describe('models holding a configuration job', () => {
    const withRoles = () => ({
      getAppConfig: jest.fn().mockResolvedValue(
        appConfig({
          interfaceConfig: { defaultModel: { endpoint: 'gw', model: 'a/enabled' } },
          deepResearch: {
            endpoint: 'gw',
            modes: { deep: { leadModel: 'a/also-enabled', workerModel: 'a/enabled' } },
          },
          endpoints: {
            custom: [
              {
                name: 'gw',
                baseURL: 'http://gw/v1',
                apiKey: 'k',
                titleModel: 'a/also-enabled',
                models: { default: ['a/enabled', 'a/also-enabled'] },
              },
            ],
          },
        }),
      ),
    });

    /** Dropping these breaks new chats, titles or Deep Research for everyone at
     *  once, and the admin cannot see that from this screen. */
    it('refuses to drop the default chat model and names the setting', async () => {
      const { res, deps } = await put({ endpoint: 'gw', models: ['a/also-enabled'] }, withRoles());

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toContain('a/enabled');
      expect(res.body.error).toContain('defaultModel');
      expect(deps.patchConfigFields).not.toHaveBeenCalled();
    });

    it('refuses to drop the title model and a Deep Research role', async () => {
      const { res } = await put({ endpoint: 'gw', models: ['a/enabled'] }, withRoles());

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toContain('titleModel');
      expect(res.body.error).toContain('deepResearch.deep.leadModel');
    });

    it('allows a change that keeps every job filled', async () => {
      const { res } = await put(
        { endpoint: 'gw', models: ['a/enabled', 'a/also-enabled', 'a/available'] },
        withRoles(),
      );

      expect(res.statusCode).toBe(200);
    });

    it('surfaces the jobs on the catalogue so the screen can lock those rows', async () => {
      const { getCatalogue } = createModelCatalogueHandlers(createDeps(withRoles()) as never);
      const res = fakeRes();

      await getCatalogue(fakeReq(), res);

      const models = res.body.endpoints[0].models;
      expect(modelById(models, 'a/enabled').roles).toEqual([
        'defaultModel',
        'deepResearch.deep.workerModel',
      ]);
      expect(modelById(models, 'a/available').roles).toEqual([]);
    });
  });

  it('answers 500 rather than throwing when the write fails', async () => {
    const { res } = await put(
      { endpoint: 'gw', models: ['a/enabled'] },
      { patchConfigFields: jest.fn().mockRejectedValue(new Error('mongo down')) },
    );

    expect(res.statusCode).toBe(500);
  });
});

/**
 * A blind overwrite of `endpoints.custom` would drop a sibling endpoint's list,
 * and restating every endpoint from the merged config would silently freeze lists
 * nobody asked to change.
 */
describe('mergeEndpointOverride', () => {
  it('creates the entry when nothing is stored yet', () => {
    expect(mergeEndpointOverride(undefined, 'gw', ['m1'])).toEqual([
      { name: 'gw', models: { default: ['m1'] } },
    ]);
  });

  it('replaces only the target endpoint list, leaving siblings untouched', () => {
    const stored = [
      { name: 'other', models: { default: ['keep/me'] } },
      { name: 'gw', models: { default: ['old'] } },
    ];

    expect(mergeEndpointOverride(stored, 'gw', ['new'])).toEqual([
      { name: 'other', models: { default: ['keep/me'] } },
      { name: 'gw', models: { default: ['new'] } },
    ]);
  });

  it('keeps other fields already overridden on the same endpoint', () => {
    const stored = [{ name: 'gw', titleModel: 'x', models: { default: ['old'], fetch: false } }];

    expect(mergeEndpointOverride(stored, 'gw', ['new'])).toEqual([
      { name: 'gw', titleModel: 'x', models: { default: ['new'], fetch: false } },
    ]);
  });

  it('appends without disturbing an unrelated stored endpoint', () => {
    const stored = [{ name: 'other', models: { default: ['keep/me'] } }];

    expect(mergeEndpointOverride(stored, 'gw', ['m1'])).toEqual([
      { name: 'other', models: { default: ['keep/me'] } },
      { name: 'gw', models: { default: ['m1'] } },
    ]);
  });

  it('survives a stored value of the wrong shape', () => {
    expect(mergeEndpointOverride('nonsense', 'gw', ['m1'])).toEqual([
      { name: 'gw', models: { default: ['m1'] } },
    ]);
  });
});

describe('collectModelRoles', () => {
  it('attributes the default model only to its own endpoint', () => {
    const config = appConfig({
      interfaceConfig: { defaultModel: { endpoint: 'other', model: 'a/enabled' } },
    });

    expect(collectModelRoles(config, 'gw', { name: 'gw' })).toEqual(new Map());
  });

  /** A Deep Research endpoint that is set scopes its roles to that endpoint. */
  it('ignores Deep Research roles belonging to another endpoint', () => {
    const config = appConfig({
      deepResearch: { endpoint: 'other', modes: { deep: { leadModel: 'a/enabled' } } },
    });

    expect(collectModelRoles(config, 'gw', { name: 'gw' })).toEqual(new Map());
  });

  /** Unscoped Deep Research could run on any endpoint — warn everywhere. */
  it('reports Deep Research roles everywhere when no endpoint is designated', () => {
    const config = appConfig({
      deepResearch: { modes: { economy: { leadModel: 'a/enabled' } } },
    });

    expect(collectModelRoles(config, 'gw', { name: 'gw' })).toEqual(
      new Map([['a/enabled', ['deepResearch.economy.leadModel']]]),
    );
  });

  it('collects several jobs for one model', () => {
    const config = appConfig({
      interfaceConfig: { defaultModel: { endpoint: 'gw', model: 'a/enabled' } },
    });

    expect(collectModelRoles(config, 'gw', { name: 'gw', titleModel: 'a/enabled' })).toEqual(
      new Map([['a/enabled', ['defaultModel', 'titleModel']]]),
    );
  });

  it('ignores blank and non-string model names', () => {
    const config = appConfig({
      interfaceConfig: { defaultModel: { endpoint: 'gw', model: '' } },
    });

    expect(collectModelRoles(config, 'gw', { name: 'gw', titleModel: 42 })).toEqual(new Map());
  });
});
