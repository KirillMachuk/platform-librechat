import { EModelEndpoint } from 'librechat-data-provider';
import { getModelTokenValue, getModelMaxTokens, getModelMaxOutputTokens } from './tokens';

describe('getModelTokenValue — exact match honors the requested key', () => {
  /** Shape of the live OpenRouter token config (objects, not bare numbers). */
  const liveConfig = {
    'anthropic/claude-sonnet-4.6': { prompt: 3, completion: 15, context: 200000, output: 64000 },
  };

  it('returns the output cap for key="output" (not the context size)', () => {
    expect(getModelTokenValue('anthropic/claude-sonnet-4.6', liveConfig, 'output')).toBe(64000);
  });

  it('returns the context window for key="context"', () => {
    expect(getModelTokenValue('anthropic/claude-sonnet-4.6', liveConfig, 'context')).toBe(200000);
  });

  it('getModelMaxOutputTokens reads the real output cap from the live config', () => {
    expect(
      getModelMaxOutputTokens('anthropic/claude-sonnet-4.6', EModelEndpoint.custom, liveConfig),
    ).toBe(64000);
  });

  it('getModelMaxTokens still reads the context window from the live config', () => {
    expect(
      getModelMaxTokens('anthropic/claude-sonnet-4.6', EModelEndpoint.custom, liveConfig),
    ).toBe(200000);
  });

  it('returns undefined for an output lookup when the entry has no output metric', () => {
    const noOutput = { 'acme/quasar-7b': { prompt: 1, completion: 1, context: 100000 } };
    expect(
      getModelMaxOutputTokens('acme/quasar-7b', EModelEndpoint.custom, noOutput),
    ).toBeUndefined();
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
