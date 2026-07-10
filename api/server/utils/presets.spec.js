const {
  stripDroppedPresetParams,
  resolveEndpointDropParams,
  PROTECTED_PRESET_KEYS,
} = require('./presets');

const appConfig = {
  endpoints: {
    custom: [
      { name: '1ma', dropParams: ['stop', 'web_search'] },
      { name: 'Other', dropParams: [] },
    ],
  },
};

describe('resolveEndpointDropParams', () => {
  it('resolves dropParams for a matching endpoint (case-insensitive name match)', () => {
    expect(resolveEndpointDropParams(appConfig, '1ma')).toEqual(['stop', 'web_search']);
  });

  it('returns [] for an endpoint with no dropParams', () => {
    expect(resolveEndpointDropParams(appConfig, 'Other')).toEqual([]);
  });

  it('returns [] for an unknown endpoint', () => {
    expect(resolveEndpointDropParams(appConfig, 'nope')).toEqual([]);
  });

  it('returns [] when config or endpoint is missing', () => {
    expect(resolveEndpointDropParams(undefined, '1ma')).toEqual([]);
    expect(resolveEndpointDropParams(appConfig, undefined)).toEqual([]);
    expect(resolveEndpointDropParams({}, '1ma')).toEqual([]);
  });
});

describe('stripDroppedPresetParams', () => {
  it('strips dropped params from the preset while keeping everything else', () => {
    const update = {
      presetId: 'p1',
      title: 'My preset',
      endpoint: '1ma',
      model: 'gpt-4o',
      temperature: 0.7,
      stop: ['\n'],
      web_search: true,
    };
    const result = stripDroppedPresetParams(update, appConfig);
    expect(result).toEqual({
      presetId: 'p1',
      title: 'My preset',
      endpoint: '1ma',
      model: 'gpt-4o',
      temperature: 0.7,
    });
  });

  it('does not mutate the input object', () => {
    const update = { endpoint: '1ma', stop: ['\n'], temperature: 0.5 };
    const result = stripDroppedPresetParams(update, appConfig);
    expect(update.stop).toEqual(['\n']);
    expect(result).not.toBe(update);
  });

  it('returns the input unchanged when the endpoint drops nothing', () => {
    const update = { endpoint: 'Other', temperature: 0.5, stop: ['\n'] };
    expect(stripDroppedPresetParams(update, appConfig)).toBe(update);
  });

  it('never strips protected structural keys even if misconfigured in dropParams', () => {
    const config = {
      endpoints: { custom: [{ name: '1ma', dropParams: ['model', 'endpoint', 'temperature'] }] },
    };
    const update = { endpoint: '1ma', model: 'gpt-4o', temperature: 0.7 };
    const result = stripDroppedPresetParams(update, config);
    expect(result.endpoint).toBe('1ma');
    expect(result.model).toBe('gpt-4o');
    expect(result.temperature).toBeUndefined();
  });

  it('protects every documented structural key', () => {
    for (const key of PROTECTED_PRESET_KEYS) {
      const config = { endpoints: { custom: [{ name: '1ma', dropParams: [key] }] } };
      const update = { endpoint: '1ma', [key]: 'value' };
      const result = stripDroppedPresetParams(update, config);
      expect(result[key]).toBe('value');
    }
  });

  it('handles a missing app config safely (strips nothing)', () => {
    const update = { endpoint: '1ma', stop: ['\n'] };
    expect(stripDroppedPresetParams(update, undefined)).toBe(update);
  });
});
