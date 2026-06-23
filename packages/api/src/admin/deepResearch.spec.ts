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
  body: undefined | { activeMode?: string; modes?: Array<{ name: string }>; error?: string };
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

function createHandlers(overrides = {}) {
  const deps = {
    getAppConfig: jest.fn().mockResolvedValue(appConfig('balanced')),
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
});
