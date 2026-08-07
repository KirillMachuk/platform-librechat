import type { TCustomConfig, TModelSpec } from 'librechat-data-provider';
import { initializeCustom } from './initialize';

jest.mock('@librechat/data-schemas', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const ENDPOINT = '1ma';

/** Endpoint-level params reach every model on the endpoint; a fallback list naming
 *  DeepSeek first must therefore come from the spec, or it rides along on Anthropic too. */
const ENDPOINT_ADD_PARAMS = { provider: { order: ['DeepInfra'], allow_fallbacks: true } };

const AUTO_SPEC = {
  name: 'auto',
  label: 'Авто',
  addParams: { models: ['deepseek/deepseek-v4-flash-0731', 'anthropic/claude-sonnet-5'] },
  preset: { endpoint: ENDPOINT, model: 'deepseek/deepseek-v4-flash-0731' },
} as unknown as TModelSpec;

/** Режим задаёт маршрут ПОВЕРХ карточки: иначе Умный уехал бы на дешёвый мозг. */
const AUTO_CONFIG = {
  spec: 'auto',
  activeMode: 'smart' as const,
  modes: {
    smart: {
      model: 'anthropic/claude-opus-5',
      researcherId: 'researcher-smart',
      fallbackModels: ['anthropic/claude-sonnet-5'],
    },
  },
};

function makeReq(spec?: string, withModes = false) {
  return {
    body: { ...(spec ? { spec } : {}) },
    user: { id: 'u1' },
    config: {
      endpoints: {
        custom: [
          {
            name: ENDPOINT,
            apiKey: 'k',
            baseURL: 'http://anonymizer:8000/v1',
            addParams: ENDPOINT_ADD_PARAMS,
            models: { default: ['deepseek/deepseek-v4-flash-0731'] },
          } as unknown as TCustomConfig,
        ],
      },
      modelSpecs: { list: [AUTO_SPEC] },
      ...(withModes ? { auto: AUTO_CONFIG } : {}),
    },
  };
}

async function kwargsFor(spec?: string, withModes = false) {
  const { llmConfig } = await initializeCustom({
    req: makeReq(spec, withModes) as never,
    endpoint: ENDPOINT,
    model_parameters: { model: 'deepseek/deepseek-v4-flash-0731' },
  } as never);
  return (llmConfig as { modelKwargs?: Record<string, unknown> }).modelKwargs ?? {};
}

describe('addParams: карточка поверх эндпоинта', () => {
  it('без карточки в теле запроса едут только параметры эндпоинта', async () => {
    const kwargs = await kwargsFor();
    expect(kwargs.provider).toEqual(ENDPOINT_ADD_PARAMS.provider);
    expect(kwargs.models).toBeUndefined();
  });

  it('карточка «Авто» добавляет свой список запасных моделей', async () => {
    const kwargs = await kwargsFor('auto');
    expect(kwargs.models).toEqual(['deepseek/deepseek-v4-flash-0731', 'anthropic/claude-sonnet-5']);
  });

  it('и при этом НЕ теряет пин площадки с эндпоинта', async () => {
    const kwargs = await kwargsFor('auto');
    expect(kwargs.provider).toEqual(ENDPOINT_ADD_PARAMS.provider);
  });

  it('неизвестное имя карточки не ломает запрос', async () => {
    const kwargs = await kwargsFor('нет-такой-карточки');
    expect(kwargs.provider).toEqual(ENDPOINT_ADD_PARAMS.provider);
    expect(kwargs.models).toBeUndefined();
  });

  it('активный режим ведёт маршрут СВОИМ мозгом, перекрывая список карточки', async () => {
    const kwargs = await kwargsFor('auto', true);
    expect(kwargs.models).toEqual(['anthropic/claude-opus-5', 'anthropic/claude-sonnet-5']);
    expect(kwargs.provider).toEqual(ENDPOINT_ADD_PARAMS.provider);
  });
});
