import { BASE_CONFIG_PRINCIPAL_ID } from '@librechat/data-schemas';
import { PrincipalType, PrincipalModel } from 'librechat-data-provider';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import { createDeepResearchSettingsHandlers } from './deepResearch';

function mockReq(overrides = {}) {
  return {
    user: { id: 'u1', role: 'ADMIN', tenantId: 't1' },
    params: {},
    body: {},
    query: {},
    ...overrides,
  } as Partial<ServerRequest> as ServerRequest;
}

interface MockRes {
  statusCode: number;
  body:
    | undefined
    | {
        activeMode?: string;
        modes?: Array<{ name: string }>;
        availableModels?: string[];
        error?: string;
      };
  status: jest.Mock;
  json: jest.Mock;
}

function mockRes() {
  const res: MockRes = {
    statusCode: 200,
    body: undefined,
    status: jest.fn((code: number) => {
      res.statusCode = code;
      return res;
    }),
    json: jest.fn((data: MockRes['body']) => {
      res.body = data;
      return res;
    }),
  };
  return res as Partial<Response> as Response & MockRes;
}

const appConfig = (activeMode?: string) => ({
  deepResearch: {
    activeMode,
    modes: { balanced: { leadModel: 'anthropic/claude-sonnet-4.6' } },
  },
});

const AVAILABLE = [
  'anthropic/claude-sonnet-4.6',
  'anthropic/claude-opus-4.8',
  'deepseek/deepseek-v4-pro',
  'deepseek/deepseek-v3.2',
];

function createHandlers(overrides = {}) {
  const deps = {
    getAppConfig: jest.fn().mockResolvedValue(appConfig('balanced')),
    // The endpoint also offers a reasoning model; it must be excluded from availableModels.
    getModelsConfig: jest.fn().mockResolvedValue({ '1ma': [...AVAILABLE, 'openai/gpt-5.5'] }),
    patchConfigFields: jest.fn().mockResolvedValue({ _id: 'c1' }),
    invalidateConfigCaches: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { handlers: createDeepResearchSettingsHandlers(deps), deps };
}

describe('createDeepResearchSettingsHandlers', () => {
  describe('getSettings', () => {
    it('returns the active mode and all three resolved tiers', async () => {
      const { handlers } = createHandlers();
      const res = mockRes();

      await handlers.getSettings(mockReq(), res);

      expect(res.statusCode).toBe(200);
      expect(res.body?.activeMode).toBe('balanced');
      expect(res.body?.modes?.map((m) => m.name)).toEqual(['economy', 'balanced', 'deep']);
      // Excludes the reasoning model (gpt-5.5) — not a valid DR tool-node model.
      expect(res.body?.availableModels).toEqual([...AVAILABLE].sort());
      expect(res.body?.availableModels).not.toContain('openai/gpt-5.5');
    });

    it('defaults activeMode to "deep" when no deepResearch config is present', async () => {
      const { handlers } = createHandlers({
        getAppConfig: jest.fn().mockResolvedValue({}),
      });
      const res = mockRes();

      await handlers.getSettings(mockReq(), res);

      expect(res.body?.activeMode).toBe('deep');
    });

    it('returns 500 when the config load fails', async () => {
      const { handlers } = createHandlers({
        getAppConfig: jest.fn().mockRejectedValue(new Error('boom')),
      });
      const res = mockRes();

      await handlers.getSettings(mockReq(), res);

      expect(res.statusCode).toBe(500);
    });
  });

  describe('setActiveMode', () => {
    it('rejects an invalid mode without writing', async () => {
      const { handlers, deps } = createHandlers();
      const res = mockRes();

      await handlers.setActiveMode(mockReq({ body: { activeMode: 'turbo' } }), res);

      expect(res.statusCode).toBe(400);
      expect(deps.patchConfigFields).not.toHaveBeenCalled();
      expect(deps.invalidateConfigCaches).not.toHaveBeenCalled();
    });

    it('rejects a missing mode without writing', async () => {
      const { handlers, deps } = createHandlers();
      const res = mockRes();

      await handlers.setActiveMode(mockReq({ body: {} }), res);

      expect(res.statusCode).toBe(400);
      expect(deps.patchConfigFields).not.toHaveBeenCalled();
    });

    it('patches the base-principal override, invalidates caches, and returns the new mode', async () => {
      // After the override is written, the refreshed read reflects the new mode.
      const getAppConfig = jest.fn().mockResolvedValue(appConfig('economy'));
      const { handlers, deps } = createHandlers({ getAppConfig });
      const res = mockRes();

      await handlers.setActiveMode(mockReq({ body: { activeMode: 'economy' } }), res);

      expect(deps.patchConfigFields).toHaveBeenCalledWith(
        PrincipalType.ROLE,
        BASE_CONFIG_PRINCIPAL_ID,
        PrincipalModel.ROLE,
        { 'deepResearch.activeMode': 'economy' },
        10,
      );
      expect(deps.invalidateConfigCaches).toHaveBeenCalledWith('t1');
      expect(getAppConfig).toHaveBeenLastCalledWith({ tenantId: 't1', refresh: true });
      expect(res.statusCode).toBe(200);
      expect(res.body?.activeMode).toBe('economy');
    });

    it('returns 500 when the write fails', async () => {
      const { handlers } = createHandlers({
        patchConfigFields: jest.fn().mockRejectedValue(new Error('db down')),
      });
      const res = mockRes();

      await handlers.setActiveMode(mockReq({ body: { activeMode: 'deep' } }), res);

      expect(res.statusCode).toBe(500);
    });
  });

  describe('setModeModels', () => {
    it('patches per-mode lead/worker models when both are available', async () => {
      const { handlers, deps } = createHandlers();
      const res = mockRes();

      await handlers.setModeModels(
        mockReq({
          body: {
            mode: 'balanced',
            leadModel: 'deepseek/deepseek-v4-pro',
            workerModel: 'deepseek/deepseek-v3.2',
          },
        }),
        res,
      );

      expect(res.statusCode).toBe(200);
      expect(deps.patchConfigFields).toHaveBeenCalledWith(
        PrincipalType.ROLE,
        BASE_CONFIG_PRINCIPAL_ID,
        PrincipalModel.ROLE,
        {
          'deepResearch.modes.balanced.leadModel': 'deepseek/deepseek-v4-pro',
          'deepResearch.modes.balanced.workerModel': 'deepseek/deepseek-v3.2',
        },
        10,
      );
      expect(deps.invalidateConfigCaches).toHaveBeenCalledWith('t1');
    });

    it('rejects a model not in the endpoint allowlist without writing', async () => {
      const { handlers, deps } = createHandlers();
      const res = mockRes();

      await handlers.setModeModels(
        mockReq({
          body: {
            mode: 'economy',
            leadModel: 'openai/ghost-model',
            workerModel: 'deepseek/deepseek-v3.2',
          },
        }),
        res,
      );

      expect(res.statusCode).toBe(400);
      expect(res.body?.error).toContain('openai/ghost-model');
      expect(deps.patchConfigFields).not.toHaveBeenCalled();
    });

    it('rejects an invalid mode without writing', async () => {
      const { handlers, deps } = createHandlers();
      const res = mockRes();

      await handlers.setModeModels(
        mockReq({
          body: {
            mode: 'turbo',
            leadModel: 'deepseek/deepseek-v4-pro',
            workerModel: 'deepseek/deepseek-v3.2',
          },
        }),
        res,
      );

      expect(res.statusCode).toBe(400);
      expect(deps.patchConfigFields).not.toHaveBeenCalled();
    });

    it('patches only the provided field (lead-only) without touching the sibling', async () => {
      const { handlers, deps } = createHandlers();
      const res = mockRes();

      await handlers.setModeModels(
        mockReq({ body: { mode: 'deep', leadModel: 'anthropic/claude-opus-4.8' } }),
        res,
      );

      expect(res.statusCode).toBe(200);
      expect(deps.patchConfigFields).toHaveBeenCalledWith(
        PrincipalType.ROLE,
        BASE_CONFIG_PRINCIPAL_ID,
        PrincipalModel.ROLE,
        { 'deepResearch.modes.deep.leadModel': 'anthropic/claude-opus-4.8' },
        10,
      );
    });

    it('rejects a reasoning model (would 400 on DR tool calls) without writing', async () => {
      const { handlers, deps } = createHandlers();
      const res = mockRes();

      await handlers.setModeModels(
        mockReq({ body: { mode: 'balanced', workerModel: 'openai/gpt-5.5' } }),
        res,
      );

      expect(res.statusCode).toBe(400);
      expect(res.body?.error).toContain('openai/gpt-5.5');
      expect(deps.patchConfigFields).not.toHaveBeenCalled();
    });

    it('rejects when neither model is provided', async () => {
      const { handlers, deps } = createHandlers();
      const res = mockRes();

      await handlers.setModeModels(mockReq({ body: { mode: 'deep' } }), res);

      expect(res.statusCode).toBe(400);
      expect(deps.patchConfigFields).not.toHaveBeenCalled();
    });
  });

  describe('endpoint scoping (deepResearch.endpoint)', () => {
    const appConfigWithEndpoint = (endpoint?: string) => ({
      deepResearch: {
        activeMode: 'balanced',
        endpoint,
        modes: { balanced: { leadModel: 'anthropic/claude-sonnet-4.6' } },
      },
    });
    // Two endpoints with disjoint models — scoping must pick only the DR endpoint's.
    const MULTI = { '1ma': [...AVAILABLE], other: ['other/exclusive-model'] };

    it('scopes availableModels to the configured DR endpoint', async () => {
      const { handlers } = createHandlers({
        getAppConfig: jest.fn().mockResolvedValue(appConfigWithEndpoint('1ma')),
        getModelsConfig: jest.fn().mockResolvedValue(MULTI),
      });
      const res = mockRes();

      await handlers.getSettings(mockReq(), res);

      expect(res.body?.availableModels).toEqual([...AVAILABLE].sort());
      expect(res.body?.availableModels).not.toContain('other/exclusive-model');
    });

    it('unions all endpoints when no DR endpoint is configured', async () => {
      const { handlers } = createHandlers({
        getAppConfig: jest.fn().mockResolvedValue(appConfigWithEndpoint(undefined)),
        getModelsConfig: jest.fn().mockResolvedValue(MULTI),
      });
      const res = mockRes();

      await handlers.getSettings(mockReq(), res);

      expect(res.body?.availableModels).toContain('other/exclusive-model');
    });

    it('falls back to the union when the configured endpoint has no models (no brick)', async () => {
      const { handlers } = createHandlers({
        getAppConfig: jest.fn().mockResolvedValue(appConfigWithEndpoint('missing')),
        getModelsConfig: jest.fn().mockResolvedValue(MULTI),
      });
      const res = mockRes();

      await handlers.getSettings(mockReq(), res);

      expect(res.body?.availableModels).toContain('other/exclusive-model');
    });

    it('write validation rejects a model outside the scoped DR endpoint', async () => {
      const { handlers, deps } = createHandlers({
        getAppConfig: jest.fn().mockResolvedValue(appConfigWithEndpoint('1ma')),
        getModelsConfig: jest.fn().mockResolvedValue(MULTI),
      });
      const res = mockRes();

      await handlers.setModeModels(
        mockReq({ body: { mode: 'balanced', leadModel: 'other/exclusive-model' } }),
        res,
      );

      expect(res.statusCode).toBe(400);
      expect(res.body?.error).toContain('other/exclusive-model');
      expect(deps.patchConfigFields).not.toHaveBeenCalled();
    });
  });
});
