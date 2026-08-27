import { EModelEndpoint } from 'librechat-data-provider';
import cleanupPreset from '../cleanupPreset';

/**
 * Integration tests for cleanupPreset — NO mocks.
 * Uses the real parseConvo to verify actual schema behavior
 * with defaultParamsEndpoint for custom endpoints.
 */
describe('cleanupPreset - real parsing with defaultParamsEndpoint', () => {
  it('should preserve maxOutputTokens when defaultParamsEndpoint is anthropic', () => {
    const preset = {
      presetId: 'test-id',
      title: 'Claude Opus',
      endpoint: 'AnthropicClaude',
      endpointType: EModelEndpoint.custom,
      model: 'anthropic/claude-opus-4.5',
      temperature: 0.7,
      maxOutputTokens: 8192,
      topP: 0.9,
      maxContextTokens: 50000,
    };

    const result = cleanupPreset({
      preset,
      defaultParamsEndpoint: EModelEndpoint.anthropic,
    });

    expect(result.maxOutputTokens).toBe(8192);
    expect(result.topP).toBe(0.9);
    expect(result.temperature).toBe(0.7);
    expect(result.maxContextTokens).toBe(50000);
    expect(result.model).toBe('anthropic/claude-opus-4.5');
  });

  it('should strip maxOutputTokens without defaultParamsEndpoint (OpenAI schema)', () => {
    const preset = {
      presetId: 'test-id',
      title: 'GPT Custom',
      endpoint: 'MyOpenRouter',
      endpointType: EModelEndpoint.custom,
      model: 'gpt-4o',
      temperature: 0.7,
      maxOutputTokens: 8192,
      max_tokens: 4096,
    };

    const result = cleanupPreset({ preset });

    expect(result.maxOutputTokens).toBeUndefined();
    expect(result.max_tokens).toBe(4096);
    expect(result.temperature).toBe(0.7);
  });

  it('should strip OpenAI-specific fields when using anthropic params', () => {
    const preset = {
      presetId: 'test-id',
      title: 'Claude Custom',
      endpoint: 'AnthropicClaude',
      endpointType: EModelEndpoint.custom,
      model: 'anthropic/claude-3-opus',
      max_tokens: 4096,
      top_p: 0.9,
      presence_penalty: 0.5,
      frequency_penalty: 0.3,
      temperature: 0.7,
    };

    const result = cleanupPreset({
      preset,
      defaultParamsEndpoint: EModelEndpoint.anthropic,
    });

    expect(result.max_tokens).toBeUndefined();
    expect(result.top_p).toBeUndefined();
    expect(result.presence_penalty).toBeUndefined();
    expect(result.frequency_penalty).toBeUndefined();
    expect(result.temperature).toBe(0.7);
  });

  it('should not carry bedrock region to custom endpoint', () => {
    const preset = {
      presetId: 'test-id',
      title: 'Custom',
      endpoint: 'MyEndpoint',
      endpointType: EModelEndpoint.custom,
      model: 'gpt-4o',
      temperature: 0.7,
      region: 'us-east-1',
    };

    const result = cleanupPreset({ preset });

    expect(result.region).toBeUndefined();
    expect(result.temperature).toBe(0.7);
  });

  it('should preserve Google-specific fields when defaultParamsEndpoint is google', () => {
    const preset = {
      presetId: 'test-id',
      title: 'Gemini Custom',
      endpoint: 'MyGoogleEndpoint',
      endpointType: EModelEndpoint.custom,
      model: 'gemini-pro',
      temperature: 0.7,
      maxOutputTokens: 8192,
      topP: 0.9,
      topK: 40,
    };

    const result = cleanupPreset({
      preset,
      defaultParamsEndpoint: EModelEndpoint.google,
    });

    expect(result.maxOutputTokens).toBe(8192);
    expect(result.topP).toBe(0.9);
    expect(result.topK).toBe(40);
  });
});

/**
 * A conversation is not guaranteed to carry `endpointType`. A Deep Research run
 * persisted rows without it, and on the stand 42 of 170 conversations were in that
 * state — every one of them a research chat. A custom endpoint's NAME is not a schema
 * key, so `parseConvo` throws `Unknown endpoint: <name>` on those rows and takes its
 * caller down: Export (json/txt/markdown) and «Save as preset» both died there, both
 * without a word to the user. Resolving the family from the endpoints config fixes the
 * rows already on disk, with no data migration.
 */
describe('cleanupPreset - a custom endpoint whose conversation lost endpointType', () => {
  const preset = {
    presetId: 'test-id',
    title: 'Исследование',
    endpoint: '1ma',
    model: 'deepseek/deepseek-v4-flash-0731',
    temperature: 0.7,
  };

  it('throws without the config — the failure this fixes', () => {
    expect(() => cleanupPreset({ preset })).toThrow('Unknown endpoint: 1ma');
  });

  it('resolves the family from the endpoints config instead of throwing', () => {
    const result = cleanupPreset({
      preset,
      endpointsConfig: { '1ma': { type: EModelEndpoint.custom } },
    });

    expect(result.endpointType).toBe(EModelEndpoint.custom);
    expect(result.endpoint).toBe('1ma');
    expect(result.model).toBe('deepseek/deepseek-v4-flash-0731');
  });

  it('keeps a stored family — the config is a fallback, never an override', () => {
    const result = cleanupPreset({
      preset: { ...preset, endpointType: EModelEndpoint.custom },
      endpointsConfig: { '1ma': { type: EModelEndpoint.google } },
    });

    expect(result.endpointType).toBe(EModelEndpoint.custom);
  });

  it('still throws when the config does not describe the endpoint either', () => {
    expect(() => cleanupPreset({ preset, endpointsConfig: {} })).toThrow('Unknown endpoint: 1ma');
  });
});
