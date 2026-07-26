import { EModelEndpoint } from 'librechat-data-provider';
import type { EndpointTokenConfig } from '~/types';
import { getModelMaxTokens, getModelMaxOutputTokens } from './tokens';

describe('getModelMaxTokens partial-override fallback', () => {
  const partialOverride: EndpointTokenConfig = {
    'custom-model': { prompt: 1, completion: 2, context: 32000, output: 4096 },
  };

  it('uses the override for a listed model', () => {
    expect(getModelMaxTokens('custom-model', EModelEndpoint.openAI, partialOverride)).toBe(32000);
  });

  it('falls back to the built-in map for a model absent from a partial override', () => {
    const fallback = getModelMaxTokens('gpt-4o', EModelEndpoint.openAI, partialOverride);
    const builtin = getModelMaxTokens('gpt-4o', EModelEndpoint.openAI);
    expect(fallback).toBe(builtin);
    expect(fallback).toBeGreaterThan(100000);
  });
});

describe('getModelMaxOutputTokens partial-override fallback', () => {
  const partialOverride: EndpointTokenConfig = {
    'custom-model': { prompt: 1, completion: 2, context: 32000, output: 4096 },
  };

  it('falls back to the built-in map for a model absent from a partial override', () => {
    const fallback = getModelMaxOutputTokens('gpt-4o', EModelEndpoint.openAI, partialOverride);
    const builtin = getModelMaxOutputTokens('gpt-4o', EModelEndpoint.openAI);
    expect(fallback).toBe(builtin);
    expect(fallback).toBeGreaterThan(0);
  });
});

/**
 * OpenRouter-style ids (`vendor/model`) use dots where the built-in maps use dashes,
 * so `findMatchingPattern` silently resolves a shorter, older key: `claude-sonnet-4.6`
 * matched `claude-sonnet-4` (200k) instead of the real 1M window. Context had no
 * dot-alias table at all — only max-output did — which is what these cases pin.
 */
describe('production model ids resolve their real limits', () => {
  const custom = EModelEndpoint.custom;

  const cases: Array<{ model: string; context: number; output: number }> = [
    { model: 'anthropic/claude-sonnet-5', context: 1000000, output: 128000 },
    { model: 'anthropic/claude-opus-4.8', context: 1000000, output: 128000 },
    { model: 'anthropic/claude-sonnet-4.6', context: 1000000, output: 64000 },
    { model: 'openai/gpt-5.6-sol', context: 1050000, output: 128000 },
  ];

  it.each(cases)('$model resolves a $context context window', ({ model, context }) => {
    expect(getModelMaxTokens(model, custom)).toBe(context);
  });

  it.each(cases)('$model resolves a $output max output', ({ model, output }) => {
    expect(getModelMaxOutputTokens(model, custom)).toBe(output);
  });

  it('resolves the dot and dash spellings of a model identically', () => {
    for (const [dotted, dashed] of [
      ['anthropic/claude-opus-4.8', 'anthropic/claude-opus-4-8'],
      ['anthropic/claude-sonnet-4.6', 'anthropic/claude-sonnet-4-6'],
    ]) {
      expect(getModelMaxTokens(dotted, custom)).toBe(getModelMaxTokens(dashed, custom));
      expect(getModelMaxOutputTokens(dotted, custom)).toBe(getModelMaxOutputTokens(dashed, custom));
    }
  });

  it('leaves older models on their documented windows', () => {
    expect(getModelMaxTokens('anthropic/claude-sonnet-4', custom)).toBe(200000);
    expect(getModelMaxTokens('anthropic/claude-3-opus', custom)).toBe(200000);
    expect(getModelMaxTokens('anthropic/claude-2.1', custom)).toBe(200000);
    expect(getModelMaxTokens('openai/gpt-5.4', custom)).toBe(1050000);
  });

  it('never resolves a context window below the model max output', () => {
    for (const { model } of cases) {
      const context = getModelMaxTokens(model, custom) ?? 0;
      const output = getModelMaxOutputTokens(model, custom) ?? 0;
      expect(context).toBeGreaterThan(output);
    }
  });
});
