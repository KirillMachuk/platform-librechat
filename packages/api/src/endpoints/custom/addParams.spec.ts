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

function makeReq(spec?: string) {
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
    },
  };
}

async function kwargsFor(spec?: string) {
  const { llmConfig } = await initializeCustom({
    req: makeReq(spec) as never,
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
});
