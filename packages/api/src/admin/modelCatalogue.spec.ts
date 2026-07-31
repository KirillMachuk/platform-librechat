import { PrincipalType } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { AdminModelEndpoint, ModelCatalogueChange } from './modelCatalogue';
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
    hasConfigCapability: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

const put = async (body: unknown, overrides: Record<string, unknown> = {}) => {
  const deps = createDeps(overrides);
  const { setModels } = createModelCatalogueHandlers(deps as never);
  const res = fakeRes();
  const req = { ...fakeReq(), body } as ServerRequest & {
    modelCatalogueChange?: ModelCatalogueChange;
  };
  await setModels(req, res);
  return { res, deps, req };
};

/** The line-up the handler actually wrote for `gw`. */
const written = (deps: { patchConfigFields: jest.Mock }): string[] => {
  const entries = deps.patchConfigFields.mock.calls[0][3]['endpoints.custom'] as Array<{
    name: string;
    models: { default: string[] };
  }>;
  const entry = entries.find((item) => item.name === 'gw');
  if (!entry) {
    throw new Error('nothing was written for endpoint "gw"');
  }
  return entry.models.default;
};

/** A config whose only custom endpoint is `gw`, with the given models block. */
const customEndpoint = (models: Record<string, unknown>) =>
  appConfig({
    endpoints: {
      custom: [{ name: 'gw', baseURL: 'http://gw/v1', apiKey: 'k', models }],
    },
  });

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
  it('appends an enabled model and refreshes caches', async () => {
    const { res, deps } = await put({ endpoint: 'gw', model: 'a/available', enabled: true });

    expect(res.statusCode).toBe(200);
    expect(deps.patchConfigFields).toHaveBeenCalledWith(
      PrincipalType.ROLE,
      'base',
      expect.anything(),
      {
        'endpoints.custom': [
          { name: 'gw', models: { default: ['a/enabled', 'a/also-enabled', 'a/available'] } },
        ],
      },
      10,
    );
    expect(deps.invalidateConfigCaches).toHaveBeenCalled();
  });

  /** The first model is the fallback for new chats, so nothing else may move. */
  it('cuts a disabled model out without moving the rest', async () => {
    const { deps } = await put({ endpoint: 'gw', model: 'a/enabled', enabled: false });

    expect(written(deps)).toEqual(['a/also-enabled']);
  });

  /**
   * The change is applied to the line-up as stored, never to a list the caller sent.
   *
   * A caller that states the whole list states it from whatever it last read, so an
   * admin acting on a screen opened minutes ago would overwrite every change made
   * since — silently, and indistinguishably from an intended edit. Re-reading on this
   * side cannot tell the two apart; not accepting the list can.
   */
  it('ignores a list in the request body entirely', async () => {
    const { deps } = await put({
      endpoint: 'gw',
      model: 'a/available',
      enabled: true,
      models: ['whatever/the-caller-last-saw'],
    });

    expect(written(deps)).toEqual(['a/enabled', 'a/also-enabled', 'a/available']);
  });

  /** Asking for a state that already holds is not a change: no write, nothing audited. */
  it('is idempotent in both directions', async () => {
    const on = await put({ endpoint: 'gw', model: 'a/enabled', enabled: true });
    expect(on.res.statusCode).toBe(200);
    expect(on.deps.patchConfigFields).not.toHaveBeenCalled();
    expect(on.req.modelCatalogueChange).toBeUndefined();

    const off = await put({ endpoint: 'gw', model: 'a/available', enabled: false });
    expect(off.res.statusCode).toBe(200);
    expect(off.deps.patchConfigFields).not.toHaveBeenCalled();
    expect(off.req.modelCatalogueChange).toBeUndefined();
  });

  /** The journal has to describe what was written, not what was asked for. */
  it('leaves the applied change behind for the audit hook', async () => {
    const { req } = await put({ endpoint: 'gw', model: 'a/available', enabled: true });

    expect(req.modelCatalogueChange).toEqual({
      endpoint: 'gw',
      model: 'a/available',
      enabled: true,
      models: ['a/enabled', 'a/also-enabled', 'a/available'],
    });
  });

  /**
   * An empty list is refused rather than accepted-and-guarded-on-read: the merged
   * config would carry `[]` and nobody could start a chat.
   */
  it('refuses to leave the endpoint with no models', async () => {
    const { res, deps } = await put(
      { endpoint: 'gw', model: 'a/only', enabled: false },
      { getAppConfig: jest.fn().mockResolvedValue(customEndpoint({ default: ['a/only'] })) },
    );

    expect(res.statusCode).toBe(400);
    expect(deps.patchConfigFields).not.toHaveBeenCalled();
  });

  it('rejects a model the gateway does not serve', async () => {
    const { res, deps } = await put({ endpoint: 'gw', model: 'a/nonsense', enabled: true });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('a/nonsense');
    expect(deps.patchConfigFields).not.toHaveBeenCalled();
  });

  /**
   * `catalogue['toString']` is a function, not undefined, so a plain `!= null`
   * membership test let inherited names through and into the live model list.
   */
  it('refuses model ids that only exist on Object.prototype', async () => {
    for (const id of ['toString', 'constructor', '__proto__', 'valueOf']) {
      const { res, deps } = await put({ endpoint: 'gw', model: id, enabled: true });

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toContain('Not served by this endpoint');
      expect(deps.patchConfigFields).not.toHaveBeenCalled();
    }
  });

  /** Without a catalogue every id would look invalid and the endpoint unmanageable. */
  it('skips catalogue validation when the gateway publishes nothing', async () => {
    const { res } = await put(
      { endpoint: 'gw', model: 'anything/at-all', enabled: true },
      { fetchModelCapabilities: jest.fn().mockResolvedValue({}) },
    );

    expect(res.statusCode).toBe(200);
  });

  /**
   * Only the model being added is checked. One the provider retires stays in the
   * saved list until an admin removes it, and re-validating the whole line-up would
   * make that retirement reject every later change — including the one fixing it.
   */
  it('does not re-check models that were already saved', async () => {
    const { res, deps } = await put(
      { endpoint: 'gw', model: 'a/available', enabled: true },
      {
        getAppConfig: jest
          .fn()
          .mockResolvedValue(customEndpoint({ default: ['a/enabled', 'a/retired'] })),
      },
    );

    expect(res.statusCode).toBe(200);
    expect(written(deps)).toEqual(['a/enabled', 'a/retired', 'a/available']);
  });

  it('rejects an unknown endpoint and a malformed request', async () => {
    const status = async (body: unknown) => (await put(body)).res.statusCode;

    expect(await status({ endpoint: 'nope', model: 'a/enabled', enabled: false })).toBe(400);
    expect(await status({ model: 'a/available', enabled: true })).toBe(400);
    expect(await status({ endpoint: 'gw', model: '', enabled: true })).toBe(400);
    expect(await status({ endpoint: 'gw', model: ['a/available'], enabled: true })).toBe(400);
    expect(await status({ endpoint: 'gw', model: 'a/available' })).toBe(400);
    expect(await status({ endpoint: 'gw', model: 'a/available', enabled: 'yes' })).toBe(400);
  });

  /**
   * The list is persisted, echoed into every audit entry and delivered to every
   * client with the endpoints config — an oversized one would inflate all three.
   */
  describe('blast-radius ceilings', () => {
    it('rejects an absurdly long model id', async () => {
      const { res, deps } = await put({
        endpoint: 'gw',
        model: 'a/'.padEnd(201, 'x'),
        enabled: true,
      });

      expect(res.statusCode).toBe(400);
      expect(deps.patchConfigFields).not.toHaveBeenCalled();
    });

    it('refuses to grow a line-up past any real catalogue', async () => {
      const many = Array.from({ length: 1000 }, (_, index) => `a/model-${index}`);
      const { res, deps } = await put(
        { endpoint: 'gw', model: 'a/available', enabled: true },
        {
          getAppConfig: jest.fn().mockResolvedValue(customEndpoint({ default: many })),
          fetchModelCapabilities: jest.fn().mockResolvedValue({}),
        },
      );

      expect(res.statusCode).toBe(400);
      expect(deps.patchConfigFields).not.toHaveBeenCalled();
    });

    it('still accepts a full real catalogue', async () => {
      const many = Array.from({ length: 400 }, (_, index) => `a/model-${index}`);
      const { res } = await put(
        { endpoint: 'gw', model: 'a/available', enabled: true },
        {
          getAppConfig: jest.fn().mockResolvedValue(customEndpoint({ default: many })),
          fetchModelCapabilities: jest.fn().mockResolvedValue({}),
        },
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
      const { res, deps } = await put(
        { endpoint: 'gw', model: 'a/enabled', enabled: false },
        withRoles(),
      );

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toContain('a/enabled');
      expect(res.body.error).toContain('defaultModel');
      expect(deps.patchConfigFields).not.toHaveBeenCalled();
    });

    it('refuses to drop the title model and names its Deep Research role too', async () => {
      const { res } = await put(
        { endpoint: 'gw', model: 'a/also-enabled', enabled: false },
        withRoles(),
      );

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toContain('titleModel');
      expect(res.body.error).toContain('deepResearch.deep.leadModel');
    });

    it('allows a change that leaves every job filled', async () => {
      const { res } = await put(
        { endpoint: 'gw', model: 'a/available', enabled: true },
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
      { endpoint: 'gw', model: 'a/available', enabled: true },
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

    expect(collectModelRoles(config, 'gw', { name: 'gw' }).roles).toEqual(new Map());
  });

  /** A Deep Research endpoint that is set scopes its roles to that endpoint. */
  it('ignores Deep Research roles belonging to another endpoint', () => {
    const config = appConfig({
      deepResearch: { endpoint: 'other', modes: { deep: { leadModel: 'a/enabled' } } },
    });

    expect(collectModelRoles(config, 'gw', { name: 'gw' }).roles).toEqual(new Map());
  });

  /** Unscoped Deep Research could run on any endpoint — warn everywhere. */
  it('reports Deep Research roles everywhere when no endpoint is designated', () => {
    const config = appConfig({
      deepResearch: { modes: { economy: { leadModel: 'a/enabled' } } },
    });

    expect(collectModelRoles(config, 'gw', { name: 'gw' }).roles).toEqual(
      new Map([['a/enabled', ['deepResearch.economy.leadModel']]]),
    );
  });

  it('collects several jobs for one model', () => {
    const config = appConfig({
      interfaceConfig: { defaultModel: { endpoint: 'gw', model: 'a/enabled' } },
    });

    expect(collectModelRoles(config, 'gw', { name: 'gw', titleModel: 'a/enabled' }).roles).toEqual(
      new Map([['a/enabled', ['defaultModel', 'titleModel']]]),
    );
  });

  it('ignores blank and non-string model names', () => {
    const config = appConfig({
      interfaceConfig: { defaultModel: { endpoint: 'gw', model: '' } },
    });

    expect(collectModelRoles(config, 'gw', { name: 'gw', titleModel: 42 }).roles).toEqual(
      new Map(),
    );
  });
});

describe('setModels: hardening', () => {
  /** `models.fetch` makes the gateway authoritative — storing a list would lie. */
  it('refuses an endpoint that takes its list from the gateway', async () => {
    const { res, deps } = await put(
      { endpoint: 'gw', model: 'a/available', enabled: true },
      {
        getAppConfig: jest
          .fn()
          .mockResolvedValue(customEndpoint({ fetch: true, default: ['a/enabled'] })),
      },
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('models.fetch');
    expect(deps.patchConfigFields).not.toHaveBeenCalled();
  });

  /**
   * Without `includeInactive` a deactivated base document reads back as null and
   * the merge starts from an empty array, wiping every sibling endpoint.
   */
  it('reads the base config including an inactive document', async () => {
    const { deps } = await put({ endpoint: 'gw', model: 'a/available', enabled: true });

    expect(deps.findConfigByPrincipal).toHaveBeenCalledWith(
      PrincipalType.ROLE,
      'base',
      expect.objectContaining({ includeInactive: true }),
    );
  });

  /** A stale read would silently drop a sibling endpoint another admin just saved. */
  it('refuses rather than overwrite when the stored lists changed mid-save', async () => {
    const first = { overrides: { endpoints: { custom: [{ name: 'other', models: {} }] } } };
    const second = {
      overrides: {
        endpoints: {
          custom: [
            { name: 'other', models: {} },
            { name: 'gw2', models: {} },
          ],
        },
      },
    };
    const { res, deps } = await put(
      { endpoint: 'gw', model: 'a/available', enabled: true },
      {
        findConfigByPrincipal: jest.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second),
      },
    );

    expect(res.statusCode).toBe(409);
    expect(deps.patchConfigFields).not.toHaveBeenCalled();
  });
});

describe('collectModelRoles: what may block a save', () => {
  /** `current_model` is a setting, not a model; treating it as an id deadlocks the endpoint. */
  it('ignores the current_model sentinel', () => {
    const { roles, blocking } = collectModelRoles(appConfig(), 'gw', {
      name: 'gw',
      titleModel: 'current_model',
    });

    expect(roles.size).toBe(0);
    expect(blocking.size).toBe(0);
  });

  /**
   * Unscoped Deep Research roles belong to no endpoint in particular: shown
   * everywhere the id appears, but they must not make another endpoint unsavable.
   */
  it('reports unscoped Deep Research roles without letting them block', () => {
    const config = appConfig({
      deepResearch: { modes: { deep: { leadModel: 'x/lead' } } },
    });

    const { roles, blocking } = collectModelRoles(config, 'gw', { name: 'gw' });

    expect(roles.get('x/lead')).toEqual(['deepResearch.deep.leadModel']);
    expect(blocking.has('x/lead')).toBe(false);
  });

  it('keeps a Deep Research role blocking when it names this endpoint', () => {
    const config = appConfig({
      deepResearch: { endpoint: 'gw', modes: { deep: { leadModel: 'x/lead' } } },
    });

    expect(collectModelRoles(config, 'gw', { name: 'gw' }).blocking.has('x/lead')).toBe(true);
  });
});

describe('permissions', () => {
  /**
   * `/api/admin/config` gates the `endpoints` section behind its own capability;
   * without the same gate here, plain admin access is a way round it.
   */
  it('refuses a write from someone without the endpoints config capability', async () => {
    const { res, deps } = await put(
      { endpoint: 'gw', model: 'a/available', enabled: true },
      { hasConfigCapability: jest.fn().mockResolvedValue(false) },
    );

    expect(res.statusCode).toBe(403);
    expect(deps.patchConfigFields).not.toHaveBeenCalled();
  });

  it('asks about the endpoints section, not about configs at large', async () => {
    const { deps } = await put({ endpoint: 'gw', model: 'a/available', enabled: true });

    expect(deps.hasConfigCapability).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u1' }),
      'endpoints',
      'manage',
    );
  });

  it('refuses a read the same way', async () => {
    const deps = createDeps({ hasConfigCapability: jest.fn().mockResolvedValue(false) });
    const { getCatalogue } = createModelCatalogueHandlers(deps as never);
    const res = fakeRes();

    await getCatalogue(fakeReq(), res);

    expect(res.statusCode).toBe(403);
  });
});

const catalogueOf = async (config: AppConfig, deps: Record<string, unknown> = {}) => {
  const { getCatalogue } = createModelCatalogueHandlers(
    createDeps({ getAppConfig: jest.fn().mockResolvedValue(config), ...deps }) as never,
  );
  const res = fakeRes();
  await getCatalogue(fakeReq(), res);
  return res.body.endpoints[0];
};

describe('what the screen has to be told about an endpoint', () => {
  it('says an ordinary endpoint is managed from here', async () => {
    expect((await catalogueOf(appConfig())).managed).toBe(true);
  });

  /**
   * Inverted once already, and invisibly: the field was written the wrong way round
   * and no screen read it, so nothing went red. `models.fetch` makes the gateway's
   * own list authoritative, and toggles here would be stored and audited while
   * changing nothing an employee sees.
   */
  it('says an endpoint that takes its list from the gateway is not', async () => {
    const config = customEndpoint({ fetch: true, default: ['a/enabled'] });

    expect((await catalogueOf(config)).managed).toBe(false);
  });

  it('flags a configured model the gateway stopped serving', async () => {
    const config = customEndpoint({ default: ['a/enabled', 'a/retired'] });

    const endpoint = await catalogueOf(config);

    expect(modelById(endpoint.models, 'a/retired').unserved).toBe(true);
    expect(modelById(endpoint.models, 'a/retired').enabled).toBe(true);
    expect(modelById(endpoint.models, 'a/enabled').unserved).toBeUndefined();
  });

  /** A silent gateway is not a statement that every configured model is gone. */
  it('claims nothing when the gateway published no catalogue at all', async () => {
    const endpoint = await catalogueOf(appConfig(), {
      fetchModelCapabilities: jest.fn().mockResolvedValue({}),
    });

    expect(endpoint.source).toBe('config');
    expect(endpoint.models.every((model) => model.unserved === undefined)).toBe(true);
  });
});
