import type { AppConfig } from '@librechat/data-schemas';
import type { Response } from 'express';
import { createAutoSettingsHandlers } from './auto';

jest.mock('@librechat/data-schemas', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  BASE_CONFIG_PRINCIPAL_ID: 'base',
}));

const FULL_CONFIG = {
  auto: {
    spec: 'auto',
    activeMode: 'standard',
    modes: {
      standard: { model: 'deepseek/deepseek-v4-flash-0731', researcherId: 'researcher-standard' },
      smart: { model: 'anthropic/claude-opus-5', researcherId: 'researcher-smart' },
    },
  },
} as unknown as AppConfig;

function makeRes() {
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
  return res as unknown as Response & { statusCode: number; body: unknown };
}

function makeDeps(config: AppConfig) {
  const patched: Record<string, unknown>[] = [];
  const invalidated: unknown[] = [];
  return {
    patched,
    invalidated,
    getAppConfig: async () => config,
    patchConfigFields: async (
      _p: unknown,
      _i: unknown,
      _m: unknown,
      fields: Record<string, unknown>,
    ) => {
      patched.push(fields);
    },
    invalidateConfigCaches: async (tenantId?: string) => {
      invalidated.push(tenantId ?? null);
    },
  };
}

const req = { user: { id: 'u1' }, body: {} } as never;

describe('админская ручка режимов «Авто»', () => {
  it('показывает активный режим и оба варианта', async () => {
    const deps = makeDeps(FULL_CONFIG);
    const res = makeRes();

    await createAutoSettingsHandlers(deps).getSettings(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      activeMode: 'standard',
      enabled: true,
      modes: [
        { name: 'standard', configured: true },
        { name: 'smart', configured: true, model: 'anthropic/claude-opus-5' },
      ],
    });
  });

  it('переключает режим и сбрасывает кэш конфига', async () => {
    const deps = makeDeps(FULL_CONFIG);
    const res = makeRes();

    await createAutoSettingsHandlers(deps).setActiveMode(
      { ...(req as object), body: { activeMode: 'smart' } } as never,
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(deps.patched).toEqual([{ 'auto.activeMode': 'smart' }]);
    expect(deps.invalidated).toHaveLength(1);
  });

  it('отказывает в неизвестном режиме', async () => {
    const res = makeRes();
    await createAutoSettingsHandlers(makeDeps(FULL_CONFIG)).setActiveMode(
      { ...(req as object), body: { activeMode: 'турбо' } } as never,
      res,
    );
    expect(res.statusCode).toBe(400);
  });

  it('НЕ даёт переключиться на полунастроенный режим', async () => {
    const half = {
      auto: {
        spec: 'auto',
        activeMode: 'standard',
        modes: {
          standard: FULL_CONFIG.auto!.modes!.standard,
          smart: { model: 'anthropic/claude-opus-5' },
        },
      },
    } as unknown as AppConfig;
    const deps = makeDeps(half);
    const res = makeRes();

    await createAutoSettingsHandlers(deps).setActiveMode(
      { ...(req as object), body: { activeMode: 'smart' } } as never,
      res,
    );

    expect(res.statusCode).toBe(400);
    expect(String((res.body as { error: string }).error)).toContain('researcherId');
    expect(deps.patched).toEqual([]);
  });

  it('показывает режим, который РЕАЛЬНО отработает, а не записанную строку', async () => {
    const drifted = {
      auto: {
        spec: 'auto',
        activeMode: 'smart',
        modes: { standard: FULL_CONFIG.auto!.modes!.standard },
      },
    } as unknown as AppConfig;
    const res = makeRes();

    await createAutoSettingsHandlers(makeDeps(drifted)).getSettings(req, res);

    expect((res.body as { activeMode: string }).activeMode).toBe('standard');
    expect((res.body as { modes: { configured: boolean }[] }).modes[1].configured).toBe(false);
  });

  it('без настройки режимов сообщает, что переключать нечего', async () => {
    const res = makeRes();
    await createAutoSettingsHandlers(makeDeps({} as AppConfig)).getSettings(req, res);
    expect(res.body).toMatchObject({ enabled: false });
  });
});
