import { EModelEndpoint, getEndpointField } from 'librechat-data-provider';
import type { TEndpointsConfig, TConfig, SettingDefinition } from 'librechat-data-provider';
import {
  mapEndpoints,
  getEndpointsFilter,
  filterDroppedParams,
  modelReportsNoTools,
  getAvailableEndpoints,
  shouldApplyDefaultModelSpec,
} from './endpoints';

const asSettings = (...keys: string[]): SettingDefinition[] =>
  keys.map((key) => ({ key })) as unknown as SettingDefinition[];

const mockEndpointsConfig: TEndpointsConfig = {
  [EModelEndpoint.openAI]: { type: undefined, iconURL: 'openAI_icon.png', order: 0 },
  [EModelEndpoint.google]: { type: undefined, iconURL: 'google_icon.png', order: 1 },
  Mistral: { type: EModelEndpoint.custom, iconURL: 'custom_icon.png', order: 2 },
};

describe('getEndpointField', () => {
  it('returns undefined if endpointsConfig is undefined', () => {
    expect(getEndpointField(undefined, EModelEndpoint.openAI, 'type')).toBeUndefined();
  });

  it('returns undefined if endpoint is null', () => {
    expect(getEndpointField(mockEndpointsConfig, null, 'type')).toBeUndefined();
  });

  it('returns undefined if endpoint is undefined', () => {
    expect(getEndpointField(mockEndpointsConfig, undefined, 'type')).toBeUndefined();
  });

  it('returns the correct value for a valid endpoint and property', () => {
    expect(getEndpointField(mockEndpointsConfig, EModelEndpoint.openAI, 'order')).toEqual(0);
    expect(getEndpointField(mockEndpointsConfig, EModelEndpoint.google, 'iconURL')).toEqual(
      'google_icon.png',
    );
  });

  it('returns undefined for a valid endpoint but an invalid property', () => {
    /* Type assertion as 'nonexistentProperty' is intentionally not a valid property of TConfig */
    expect(
      getEndpointField(
        mockEndpointsConfig,
        EModelEndpoint.openAI,
        'nonexistentProperty' as keyof TConfig,
      ),
    ).toBeUndefined();
  });

  it('returns the correct value for a non-enum endpoint and valid property', () => {
    expect(getEndpointField(mockEndpointsConfig, 'Mistral', 'type')).toEqual(EModelEndpoint.custom);
  });

  it('returns undefined for a non-enum endpoint with an invalid property', () => {
    expect(
      getEndpointField(mockEndpointsConfig, 'Mistral', 'nonexistentProperty' as keyof TConfig),
    ).toBeUndefined();
  });
});

describe('getEndpointsFilter', () => {
  it('returns an empty object if endpointsConfig is undefined', () => {
    expect(getEndpointsFilter(undefined)).toEqual({});
  });

  it('returns a filter object based on endpointsConfig', () => {
    const expectedFilter = {
      [EModelEndpoint.openAI]: true,
      [EModelEndpoint.google]: true,
      Mistral: true,
    };
    expect(getEndpointsFilter(mockEndpointsConfig)).toEqual(expectedFilter);
  });
});

describe('getAvailableEndpoints', () => {
  it('returns available endpoints based on filter and config', () => {
    const filter = {
      [EModelEndpoint.openAI]: true,
      [EModelEndpoint.google]: false,
      Mistral: true,
    };
    const expectedEndpoints = [EModelEndpoint.openAI, 'Mistral'];
    expect(getAvailableEndpoints(filter, mockEndpointsConfig)).toEqual(expectedEndpoints);
  });
});

describe('mapEndpoints', () => {
  it('returns sorted available endpoints', () => {
    const expectedOrder = [EModelEndpoint.openAI, EModelEndpoint.google, 'Mistral'];
    expect(mapEndpoints(mockEndpointsConfig)).toEqual(expectedOrder);
  });
});

describe('filterDroppedParams', () => {
  it('returns the same array reference when dropParams is undefined', () => {
    const params = asSettings('temperature', 'stop');
    expect(filterDroppedParams(params, undefined)).toBe(params);
  });

  it('returns the same array reference when dropParams is empty', () => {
    const params = asSettings('temperature', 'stop');
    expect(filterDroppedParams(params, [])).toBe(params);
  });

  it('removes settings whose key is dropped', () => {
    const params = asSettings('temperature', 'stop', 'top_p');
    const result = filterDroppedParams(params, ['stop']);
    expect(result.map((p) => p.key)).toEqual(['temperature', 'top_p']);
  });

  it('hides the web_search toggle when web_search is dropped', () => {
    const params = asSettings('temperature', 'web_search');
    const result = filterDroppedParams(params, ['web_search']);
    expect(result.map((p) => p.key)).toEqual(['temperature']);
  });

  it('drops multiple params at once and leaves the rest untouched', () => {
    const params = asSettings('temperature', 'stop', 'web_search', 'top_p');
    const result = filterDroppedParams(params, ['stop', 'web_search']);
    expect(result.map((p) => p.key)).toEqual(['temperature', 'top_p']);
  });

  it('ignores dropParams entries that match no setting', () => {
    const params = asSettings('temperature', 'top_p');
    const result = filterDroppedParams(params, ['nonexistent']);
    expect(result.map((p) => p.key)).toEqual(['temperature', 'top_p']);
  });
});

describe('modelReportsNoTools', () => {
  const config = {
    gateway: {
      modelCapabilities: {
        'vendor/no-tools': { tools: false },
        'vendor/tools': { tools: true },
        'vendor/silent': {},
      },
    },
  } as unknown as TEndpointsConfig;

  it('answers yes only when the catalogue said no', () => {
    expect(modelReportsNoTools(config, 'gateway', 'vendor/no-tools')).toBe(true);
    expect(modelReportsNoTools(config, 'gateway', 'vendor/tools')).toBe(false);
  });

  /**
   * Hiding a working toggle is the harmful direction, so every kind of silence —
   * no record, no `tools` field, an endpoint the config does not cover, a config
   * that has not loaded yet — leaves the composer as it was.
   */
  it('treats silence as "unknown", never as "no"', () => {
    expect(modelReportsNoTools(config, 'gateway', 'vendor/silent')).toBe(false);
    expect(modelReportsNoTools(config, 'gateway', 'vendor/never-heard-of')).toBe(false);
    expect(modelReportsNoTools(config, 'other-gateway', 'vendor/no-tools')).toBe(false);
    expect(modelReportsNoTools(undefined, 'gateway', 'vendor/no-tools')).toBe(false);
    expect(modelReportsNoTools(config, undefined, 'vendor/no-tools')).toBe(false);
    expect(modelReportsNoTools(config, 'gateway', undefined)).toBe(false);
  });
});

describe('shouldApplyDefaultModelSpec', () => {
  const spec = (name: string) =>
    ({ name, label: name, preset: { endpoint: 'gateway', model: 'm' } }) as never;
  const config = (overrides: {
    prioritize?: boolean;
    modelSelect?: boolean;
  }): import('librechat-data-provider').TStartupConfig =>
    ({
      modelSpecs: { list: [spec('auto')], prioritize: overrides.prioritize ?? false },
      interface: { modelSelect: overrides.modelSelect ?? true },
    }) as never;

  it('applies a hard admin default on a blank new chat (spec.default, no prioritize)', () => {
    // The founding case: prioritize=false, modelSelect=true, an admin default
    // configured, and an in-session "New chat" (empty template). Before the fix
    // the predicate only honored `last`, the spec effects were skipped, and the
    // context switch wiped the tool toggles while the header still showed the spec.
    expect(
      shouldApplyDefaultModelSpec({
        result: { default: spec('auto') },
        startupConfig: config({}),
        template: {},
      }),
    ).toBe(true);
  });

  it('does not apply the default when the template carries a model selection', () => {
    expect(
      shouldApplyDefaultModelSpec({
        result: { default: spec('auto') },
        startupConfig: config({}),
        template: { endpoint: EModelEndpoint.custom, model: 'other' },
      }),
    ).toBe(false);
  });

  it('still applies the last-used spec on a blank template', () => {
    expect(
      shouldApplyDefaultModelSpec({
        result: { last: spec('picked') },
        startupConfig: config({}),
        template: {},
      }),
    ).toBe(true);
  });

  it('a lone chatProjectId still counts as a blank template', () => {
    expect(
      shouldApplyDefaultModelSpec({
        result: { default: spec('auto') },
        startupConfig: config({}),
        template: { chatProjectId: 'p1' } as never,
      }),
    ).toBe(true);
  });

  it('prioritize=true applies regardless of the template', () => {
    expect(
      shouldApplyDefaultModelSpec({
        result: { default: spec('auto') },
        startupConfig: config({ prioritize: true }),
        template: { endpoint: EModelEndpoint.custom, model: 'other' },
      }),
    ).toBe(true);
  });

  it('a disabled model selector applies regardless of the template', () => {
    expect(
      shouldApplyDefaultModelSpec({
        result: { default: spec('auto') },
        startupConfig: config({ modelSelect: false }),
        template: { endpoint: EModelEndpoint.custom, model: 'other' },
      }),
    ).toBe(true);
  });

  it('a soft default yields to an explicit model selection', () => {
    expect(
      shouldApplyDefaultModelSpec({
        result: { softDefault: spec('soft') },
        startupConfig: config({}),
        template: { endpoint: EModelEndpoint.custom, model: 'other' },
      }),
    ).toBe(false);
    expect(
      shouldApplyDefaultModelSpec({
        result: { softDefault: spec('soft') },
        startupConfig: config({}),
        template: {},
      }),
    ).toBe(true);
  });

  it('no resolved spec and a blank template does not apply', () => {
    expect(
      shouldApplyDefaultModelSpec({
        result: undefined,
        startupConfig: config({}),
        template: {},
      }),
    ).toBe(false);
  });
});
