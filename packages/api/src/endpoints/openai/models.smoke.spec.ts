import { getOpenAILLMConfig } from './llm';

/**
 * Smoke test for every production model served via OpenRouter. For each model
 * we build the request our app would send and assert the invariants that the
 * incidents this session fixed depend on — so a regression (re-enabling
 * Anthropic extended thinking, or losing the max_tokens clamp) fails CI instead
 * of silently breaking chats in production. Deterministic, no network calls.
 *
 * Keep PRODUCTION_MODELS in sync with `endpoints.custom[].models.default` in
 * 1ma-lab/librechat.yaml. Live existence of these ids on OpenRouter is checked
 * separately by scripts/check-openrouter-models.mjs (scheduled workflow).
 */
const PRODUCTION_MODELS = [
  'openai/gpt-5.5',
  'openai/gpt-5.4-mini',
  'openai/gpt-5',
  'anthropic/claude-opus-4.7',
  'anthropic/claude-sonnet-4.6',
  'deepseek/deepseek-chat',
  'google/gemini-2.5-pro',
];

const ANTHROPIC_MODELS = PRODUCTION_MODELS.filter((model) => model.startsWith('anthropic/'));

function buildOpenRouterConfig(model: string, maxTokens?: number) {
  return getOpenAILLMConfig({
    apiKey: 'test-key',
    streaming: true,
    endpoint: '1ma',
    useOpenRouter: true,
    modelOptions: maxTokens != null ? { model, max_tokens: maxTokens } : { model },
  });
}

/** The requested output length lands in `maxTokens` for most providers, but in
 * `modelKwargs.max_completion_tokens` for GPT-5+ reasoning models. */
function effectiveMaxOutput(llmConfig: {
  maxTokens?: number | null;
  modelKwargs?: Record<string, unknown>;
}): number | undefined {
  if (typeof llmConfig.maxTokens === 'number') {
    return llmConfig.maxTokens;
  }
  const moved = llmConfig.modelKwargs?.max_completion_tokens;
  return typeof moved === 'number' ? moved : undefined;
}

describe('Production model smoke test (OpenRouter request invariants)', () => {
  it.each(PRODUCTION_MODELS)('builds a valid request for %s', (model) => {
    const { llmConfig } = buildOpenRouterConfig(model);
    expect(llmConfig.model).toBe(model);
  });

  it.each(ANTHROPIC_MODELS)(
    'does not force extended thinking for %s (would break file_search)',
    (model) => {
      const { llmConfig } = buildOpenRouterConfig(model);
      expect(llmConfig).not.toHaveProperty('include_reasoning');
      expect(llmConfig).not.toHaveProperty('reasoning');
    },
  );

  it.each(PRODUCTION_MODELS)('clamps an over-cap max_tokens for %s', (model) => {
    const { llmConfig } = buildOpenRouterConfig(model, 999999);
    const effective = effectiveMaxOutput(llmConfig);
    expect(typeof effective).toBe('number');
    expect(effective).toBeLessThan(999999);
  });
});
