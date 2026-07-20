import { resolveDefaultProviderModel } from './forms';

describe('resolveDefaultProviderModel', () => {
  const modelsData = {
    '1ma': ['anthropic/claude-sonnet-5', 'openai/gpt-5.6-sol'],
  };
  const providers = ['1ma'];

  it('keeps a stored pin that is still configured', () => {
    expect(
      resolveDefaultProviderModel({
        providers,
        modelsData,
        storedProvider: '1ma',
        storedModel: 'openai/gpt-5.6-sol',
      }),
    ).toEqual({ provider: '1ma', model: 'openai/gpt-5.6-sol' });
  });

  it('falls back to the first provider and its first model for a stale pin', () => {
    expect(
      resolveDefaultProviderModel({
        providers,
        modelsData,
        storedProvider: 'openAI',
        storedModel: 'gpt-5.4-mini',
      }),
    ).toEqual({ provider: '1ma', model: 'anthropic/claude-sonnet-5' });
  });

  it('replaces only the model when the provider is valid but the model is gone', () => {
    expect(
      resolveDefaultProviderModel({
        providers,
        modelsData,
        storedProvider: '1ma',
        storedModel: 'deepseek/removed-model',
      }),
    ).toEqual({ provider: '1ma', model: 'anthropic/claude-sonnet-5' });
  });

  it('handles empty localStorage values', () => {
    expect(
      resolveDefaultProviderModel({
        providers,
        modelsData,
        storedProvider: '',
        storedModel: '',
      }),
    ).toEqual({ provider: '1ma', model: 'anthropic/claude-sonnet-5' });
  });

  it('returns empty values when nothing is configured yet', () => {
    expect(
      resolveDefaultProviderModel({
        providers: [],
        modelsData: {},
        storedProvider: 'openAI',
        storedModel: 'gpt-5.4-mini',
      }),
    ).toEqual({ provider: '', model: '' });
  });
});
