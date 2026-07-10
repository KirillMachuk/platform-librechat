import { EModelEndpoint } from 'librechat-data-provider';
import type { TCustomEndpoints } from 'librechat-data-provider';
import { loadCustomEndpointsConfig } from './config';

const baseEndpoint = {
  apiKey: 'sk-test',
  baseURL: 'https://gateway.example.com',
  models: { default: ['claude-sonnet-4-5'] },
};

describe('loadCustomEndpointsConfig – native provider param set', () => {
  it('synthesizes defaultParamsEndpoint from provider so the UI shows the right params', () => {
    const config = loadCustomEndpointsConfig([
      { ...baseEndpoint, name: 'Claude-Compatible', provider: EModelEndpoint.anthropic },
    ] as unknown as TCustomEndpoints);

    expect(config?.['Claude-Compatible']?.customParams?.defaultParamsEndpoint).toBe(
      EModelEndpoint.anthropic,
    );
  });

  it('does not set defaultParamsEndpoint for endpoints without a provider', () => {
    const config = loadCustomEndpointsConfig([
      { ...baseEndpoint, name: 'My-LLM' },
    ] as unknown as TCustomEndpoints);

    expect(config?.['My-LLM']?.customParams).toBeUndefined();
  });

  it('respects an explicit non-default defaultParamsEndpoint over the provider', () => {
    const config = loadCustomEndpointsConfig([
      {
        ...baseEndpoint,
        name: 'Claude-Compatible',
        provider: EModelEndpoint.anthropic,
        customParams: { defaultParamsEndpoint: EModelEndpoint.google },
      },
    ] as unknown as TCustomEndpoints);

    expect(config?.['Claude-Compatible']?.customParams?.defaultParamsEndpoint).toBe(
      EModelEndpoint.google,
    );
  });
});

describe('loadCustomEndpointsConfig – dropParams passthrough', () => {
  it('forwards a non-empty dropParams array to the client-facing config', () => {
    const config = loadCustomEndpointsConfig([
      { ...baseEndpoint, name: '1ma', dropParams: ['stop', 'web_search'] },
    ] as unknown as TCustomEndpoints);

    expect(config?.['1ma']?.dropParams).toEqual(['stop', 'web_search']);
  });

  it('omits dropParams entirely when the endpoint has none', () => {
    const config = loadCustomEndpointsConfig([
      { ...baseEndpoint, name: 'My-LLM' },
    ] as unknown as TCustomEndpoints);

    expect(config?.['My-LLM']).toBeDefined();
    expect(config?.['My-LLM'] && 'dropParams' in config['My-LLM']).toBe(false);
  });

  it('omits dropParams when configured as an empty array', () => {
    const config = loadCustomEndpointsConfig([
      { ...baseEndpoint, name: 'My-LLM', dropParams: [] },
    ] as unknown as TCustomEndpoints);

    expect(config?.['My-LLM'] && 'dropParams' in config['My-LLM']).toBe(false);
  });
});
