import type { AutoConfigInput } from './auto';
import { loadEphemeralAgent } from './load';

jest.mock('@librechat/data-schemas', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const ENDPOINT = '1ma';

const AUTO_CONFIG: AutoConfigInput = {
  spec: 'auto',
  activeMode: 'standard',
  modes: {
    standard: {
      model: 'deepseek/deepseek-v4-flash-0731',
      researcherId: 'researcher-standard',
      instructions: 'промпт Стандарта',
    },
    smart: {
      model: 'anthropic/claude-opus-5',
      researcherId: 'researcher-smart',
      instructions: 'промпт Умного',
    },
  },
};

const SPEC = {
  name: 'auto',
  label: 'Авто',
  webSearch: true,
  fileSearch: true,
  executeCode: true,
  subagents: { enabled: true, allowSelf: false, agent_ids: ['researcher-standard'] },
  preset: {
    endpoint: ENDPOINT,
    model: 'deepseek/deepseek-v4-flash-0731',
    promptPrefix: 'промпт из файла конфига',
  },
};

function makeReq(auto: AutoConfigInput | undefined) {
  return {
    body: { spec: 'auto' },
    user: { id: 'u1' },
    config: { modelSpecs: { list: [SPEC] }, ...(auto ? { auto } : {}) },
  };
}

/** The spec's preset is folded into the request BEFORE this loader runs
 *  (`applyModelSpecPreset`), so its prompt arrives as a model parameter — not off the spec
 *  object. Passing it any other way would test a path that does not exist. */
async function load(auto: AutoConfigInput | undefined, spec = 'auto', model?: string) {
  const isAuto = spec === 'auto';
  return loadEphemeralAgent(
    {
      req: makeReq(auto) as never,
      spec,
      endpoint: ENDPOINT,
      model_parameters: {
        model: model ?? 'deepseek/deepseek-v4-flash-0731',
        ...(isAuto ? { promptPrefix: SPEC.preset.promptPrefix } : {}),
      } as never,
    },
    { getMCPServerTools: async () => null } as never,
  );
}

describe('режим «Авто» на пути запроса', () => {
  it('без настройки режимов карточка работает как написана в файле', async () => {
    const agent = await load(undefined);
    expect(agent?.model).toBe('deepseek/deepseek-v4-flash-0731');
    expect(agent?.instructions).toBe('промпт из файла конфига');
    expect(agent?.subagents?.agent_ids).toEqual(['researcher-standard']);
  });

  it('Умный режим подменяет мозг', async () => {
    const agent = await load({ ...AUTO_CONFIG, activeMode: 'smart' });
    expect(agent?.model).toBe('anthropic/claude-opus-5');
  });

  it('Умный режим подменяет промпт', async () => {
    const agent = await load({ ...AUTO_CONFIG, activeMode: 'smart' });
    expect(agent?.instructions).toBe('промпт Умного');
  });

  it('Умный режим подменяет исследователя', async () => {
    const agent = await load({ ...AUTO_CONFIG, activeMode: 'smart' });
    expect(agent?.subagents).toEqual({
      enabled: true,
      allowSelf: false,
      agent_ids: ['researcher-smart'],
    });
  });

  it('инструменты остаются вооружены после смены мозга', async () => {
    const agent = await load({ ...AUTO_CONFIG, activeMode: 'smart' });
    expect(agent?.tools).toEqual(expect.arrayContaining(['execute_code', 'library_search']));
  });

  it('чужую карточку и ручной выбор модели не трогает', async () => {
    const agent = await load(AUTO_CONFIG, 'другая-карточка', 'anthropic/claude-sonnet-5');
    expect(agent?.model).toBe('anthropic/claude-sonnet-5');
    expect(agent?.instructions).toBeUndefined();
  });
});
