import { AuthType, ErrorTypes } from 'librechat-data-provider';
import type { BaseInitializeParams } from '~/types';

const mockValidateEndpointURL = jest.fn();
jest.mock('~/auth', () => ({
  validateEndpointURL: (...args: unknown[]) => mockValidateEndpointURL(...args),
}));

const mockGetOpenAIConfig = jest.fn().mockReturnValue({
  llmConfig: { model: 'test-model' },
  configOptions: {},
});
jest.mock('~/endpoints/openai/config', () => ({
  getOpenAIConfig: (...args: unknown[]) => mockGetOpenAIConfig(...args),
}));

jest.mock('~/endpoints/models', () => ({
  fetchModels: jest.fn(),
}));

jest.mock('~/cache', () => ({
  standardCache: jest.fn(() => ({ get: jest.fn().mockResolvedValue(null) })),
  tokenConfigCache: jest.fn(() => ({ get: jest.fn().mockResolvedValue(null) })),
}));

jest.mock('~/utils', () => ({
  isUserProvided: (val: string) => val === 'user_provided',
  checkUserKeyExpiry: jest.fn(),
}));

const mockGetCustomEndpointConfig = jest.fn();
jest.mock('~/app/config', () => ({
  getCustomEndpointConfig: (...args: unknown[]) => mockGetCustomEndpointConfig(...args),
}));

import { getTokenConfigKey, initializeCustom } from './initialize';
import { SCOPED_TOKEN_CONFIG_KEY_PREFIX } from '../keys';

function createParams(overrides: {
  apiKey?: string;
  baseURL?: string;
  userBaseURL?: string;
  userApiKey?: string;
  expiresAt?: string;
}): BaseInitializeParams {
  const { apiKey = 'sk-test-key', baseURL = 'https://api.example.com/v1' } = overrides;

  mockGetCustomEndpointConfig.mockReturnValue({
    apiKey,
    baseURL,
    models: {},
  });

  const db = {
    getUserKeyValues: jest.fn().mockResolvedValue({
      apiKey: overrides.userApiKey ?? 'sk-user-key',
      baseURL: overrides.userBaseURL ?? 'https://user-api.example.com/v1',
    }),
  } as unknown as BaseInitializeParams['db'];

  return {
    req: {
      user: { id: 'user-1' },
      body: { key: overrides.expiresAt ?? '2099-01-01' },
      config: {},
    } as unknown as BaseInitializeParams['req'],
    endpoint: 'test-custom',
    model_parameters: { model: 'gpt-4' },
    db,
  };
}

describe('initializeCustom – Agents API user key resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should fetch user key even when expiresAt is not in request body (Agents API flow)', async () => {
    const { checkUserKeyExpiry } = jest.requireMock('~/utils');
    const params = createParams({
      apiKey: AuthType.USER_PROVIDED,
      baseURL: 'https://api.example.com/v1',
      userApiKey: 'sk-user-key',
    });
    // Simulate Agents API request body (no `key` field)
    params.req.body = { model: 'agent_123' };

    await initializeCustom(params);

    expect(params.db.getUserKeyValues).toHaveBeenCalledWith({
      userId: 'user-1',
      name: 'test-custom',
    });
    expect(checkUserKeyExpiry).not.toHaveBeenCalled();
    expect(mockGetOpenAIConfig).toHaveBeenCalledWith(
      'sk-user-key',
      expect.any(Object),
      'test-custom',
    );
  });

  it('should fetch user key for user-provided URL without expiresAt (Agents API flow)', async () => {
    const { checkUserKeyExpiry } = jest.requireMock('~/utils');
    const params = createParams({
      apiKey: 'sk-system-key',
      baseURL: AuthType.USER_PROVIDED,
      userBaseURL: 'https://user-api.example.com/v1',
    });
    params.req.body = { model: 'agent_123' };

    await initializeCustom(params);

    expect(params.db.getUserKeyValues).toHaveBeenCalledWith({
      userId: 'user-1',
      name: 'test-custom',
    });
    expect(checkUserKeyExpiry).not.toHaveBeenCalled();
  });

  it('should still check key expiry when expiresAt is provided (UI flow)', async () => {
    const { checkUserKeyExpiry } = jest.requireMock('~/utils');
    const params = createParams({
      apiKey: AuthType.USER_PROVIDED,
      baseURL: 'https://api.example.com/v1',
      userApiKey: 'sk-user-key',
      expiresAt: '2099-01-01',
    });

    await initializeCustom(params);

    expect(checkUserKeyExpiry).toHaveBeenCalledWith('2099-01-01', 'test-custom');
    expect(params.db.getUserKeyValues).toHaveBeenCalled();
  });

  it('should throw EXPIRED_USER_KEY when expiresAt is expired', async () => {
    const { checkUserKeyExpiry } = jest.requireMock('~/utils');
    checkUserKeyExpiry.mockImplementationOnce(() => {
      throw new Error(JSON.stringify({ type: ErrorTypes.EXPIRED_USER_KEY }));
    });

    const params = createParams({
      apiKey: AuthType.USER_PROVIDED,
      baseURL: 'https://api.example.com/v1',
      userApiKey: 'sk-user-key',
      expiresAt: '2020-01-01',
    });

    await expect(initializeCustom(params)).rejects.toThrow(ErrorTypes.EXPIRED_USER_KEY);
    expect(params.db.getUserKeyValues).not.toHaveBeenCalled();
  });

  it('should NOT call getUserKeyValues when key and URL are system-defined', async () => {
    const params = createParams({
      apiKey: 'sk-system-key',
      baseURL: 'https://api.provider.com/v1',
    });

    await initializeCustom(params);

    expect(params.db.getUserKeyValues).not.toHaveBeenCalled();
  });
});

describe('initializeCustom – SSRF guard wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should call validateEndpointURL when baseURL is user_provided', async () => {
    const params = createParams({
      apiKey: 'sk-test-key',
      baseURL: AuthType.USER_PROVIDED,
      userBaseURL: 'https://user-api.example.com/v1',
      expiresAt: '2099-01-01',
    });

    await initializeCustom(params);

    expect(mockValidateEndpointURL).toHaveBeenCalledTimes(1);
    expect(mockValidateEndpointURL).toHaveBeenCalledWith(
      'https://user-api.example.com/v1',
      'test-custom',
      undefined,
    );
  });

  it('should NOT call validateEndpointURL when baseURL is system-defined', async () => {
    const params = createParams({
      apiKey: 'sk-test-key',
      baseURL: 'https://api.provider.com/v1',
    });

    await initializeCustom(params);

    expect(mockValidateEndpointURL).not.toHaveBeenCalled();
  });

  it('should propagate SSRF rejection from validateEndpointURL', async () => {
    mockValidateEndpointURL.mockRejectedValueOnce(
      new Error('Base URL for test-custom targets a restricted address.'),
    );

    const params = createParams({
      apiKey: 'sk-test-key',
      baseURL: AuthType.USER_PROVIDED,
      userBaseURL: 'http://169.254.169.254/latest/meta-data/',
      expiresAt: '2099-01-01',
    });

    await expect(initializeCustom(params)).rejects.toThrow('targets a restricted address');
    expect(mockGetOpenAIConfig).not.toHaveBeenCalled();
  });
});

describe('initializeCustom – live token-config fetch (OpenRouter detection)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fetches live token config for an OpenRouter baseURL even when the endpoint is white-labeled and models.fetch is off', async () => {
    const { fetchModels } = jest.requireMock('~/endpoints/models');
    const params = createParams({ baseURL: 'https://openrouter.ai/api/v1' });
    params.endpoint = '1ma';

    await initializeCustom(params);

    expect(fetchModels).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'https://openrouter.ai/api/v1', name: '1ma' }),
    );
  });

  it('does not fetch token config for a non-OpenRouter custom endpoint', async () => {
    const { fetchModels } = jest.requireMock('~/endpoints/models');
    const params = createParams({ baseURL: 'https://api.example.com/v1' });
    params.endpoint = 'test-custom';

    await initializeCustom(params);

    expect(fetchModels).not.toHaveBeenCalled();
  });
});

describe('getTokenConfigKey – tenant fallback', () => {
  const endpointConfig = {
    apiKey: 'sk-test-key',
    baseURL: 'https://openrouter.ai/api/v1',
  };

  it('keeps legacy shared keys when tenant context is unavailable or empty', () => {
    const tenantIds = [undefined, null, '', '   '] as Array<string | null | undefined>;

    for (const tenantId of tenantIds) {
      expect(getTokenConfigKey(endpointConfig, 'openrouter', 'user-1', tenantId)).toBe(
        'openrouter',
      );
    }
  });

  it('keeps legacy user-scoped keys when tenant context is unavailable or empty', () => {
    const userScopedConfig = {
      ...endpointConfig,
      headers: { Authorization: 'Bearer {{LIBRECHAT_OPENID_ID_TOKEN}}' },
    };
    const tenantIds = [undefined, null, '', '   '] as Array<string | null | undefined>;

    for (const tenantId of tenantIds) {
      expect(getTokenConfigKey(userScopedConfig, 'openrouter', 'user-1', tenantId)).toBe(
        'openrouter:user-1',
      );
    }
  });

  it('adds tenant scope only when tenant context is non-empty', () => {
    const key = getTokenConfigKey(endpointConfig, 'openrouter', 'user-1', ' tenant-a ');

    expect(key.startsWith(SCOPED_TOKEN_CONFIG_KEY_PREFIX)).toBe(true);
    expect(key).not.toBe('tenant:tenant-a:openrouter');
    expect(key).not.toContain('openrouter');
    expect(key).not.toContain('tenant-a');
    expect(key).toBe(getTokenConfigKey(endpointConfig, 'openrouter', 'user-1', 'tenant-a'));
  });
});

describe('initializeCustom – native Anthropic provider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function createAnthropicParams(
    config: Record<string, unknown>,
    model_parameters: Record<string, unknown> = { model: 'claude-sonnet-4-5' },
  ): BaseInitializeParams {
    mockGetCustomEndpointConfig.mockReturnValue(config);
    return {
      req: {
        user: { id: 'user-1', email: 'user@example.com' },
        body: { conversationId: 'convo-1' },
        config: {},
      } as unknown as BaseInitializeParams['req'],
      endpoint: 'Claude-Compatible',
      model_parameters,
      db: {
        getUserKeyValues: jest.fn().mockResolvedValue({
          apiKey: 'sk-user-key',
          baseURL: 'https://user-controlled.example.com',
        }),
        getUserKey: jest.fn(),
      } as unknown as BaseInitializeParams['db'],
    };
  }

  it('builds a native Anthropic config pointed at the custom baseURL/apiKey', async () => {
    const params = createAnthropicParams({
      provider: 'anthropic',
      apiKey: 'sk-ant-custom',
      baseURL: 'https://gateway.example.com',
      headers: { 'anthropic-version': '2023-06-01' },
      models: { default: ['claude-sonnet-4-5'] },
    });

    const options = await initializeCustom(params);

    /** Routed to the native Anthropic client, not the OpenAI-compatible one */
    expect(mockGetOpenAIConfig).not.toHaveBeenCalled();
    expect(options.provider).toBe('anthropic');
    /** Custom baseURL/key wired into the native Anthropic config */
    expect(options.llmConfig).toHaveProperty('anthropicApiUrl', 'https://gateway.example.com');
    expect(options.llmConfig).toHaveProperty('apiKey', 'sk-ant-custom');
    /** Configured header attached (kept unresolved for request-time resolution) */
    const defaultHeaders = (
      options.llmConfig as { clientOptions?: { defaultHeaders?: Record<string, string> } }
    ).clientOptions?.defaultHeaders;
    expect(defaultHeaders?.['anthropic-version']).toBe('2023-06-01');
    /** Native Anthropic path must NOT use OpenAI legacy content formatting */
    expect(options.useLegacyContent).toBeUndefined();
  });

  it('withholds configured headers when the user supplies the base URL', async () => {
    const params = createAnthropicParams({
      provider: 'anthropic',
      apiKey: 'sk-ant-custom',
      baseURL: AuthType.USER_PROVIDED,
      headers: {
        Authorization: 'Bearer ${GATEWAY_SECRET}',
        'X-User-Email': '{{LIBRECHAT_USER_EMAIL}}',
      },
      models: { default: ['claude-sonnet-4-5'] },
    });

    const options = await initializeCustom(params);

    expect(mockValidateEndpointURL).toHaveBeenCalledWith(
      'https://user-controlled.example.com',
      'Claude-Compatible',
      undefined,
    );
    expect(options.llmConfig).toHaveProperty(
      'anthropicApiUrl',
      'https://user-controlled.example.com',
    );
    const defaultHeaders = (
      options.llmConfig as { clientOptions?: { defaultHeaders?: Record<string, string> } }
    ).clientOptions?.defaultHeaders;
    expect(defaultHeaders?.Authorization).toBeUndefined();
    expect(defaultHeaders?.['X-User-Email']).toBeUndefined();
  });

  it('applies customParams.paramDefinitions defaults on the native path', async () => {
    const params = createAnthropicParams({
      provider: 'anthropic',
      apiKey: 'sk-ant-custom',
      baseURL: 'https://gateway.example.com',
      models: { default: ['claude-sonnet-4-5'] },
      customParams: {
        defaultParamsEndpoint: 'anthropic',
        paramDefinitions: [{ key: 'web_search', default: true }],
      },
    });

    const options = await initializeCustom(params);

    /** `web_search: true` default flows through to the Anthropic web_search tool */
    expect(options.tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'web_search' })]),
    );
  });

  it('still uses the OpenAI-compatible client when no provider is set', async () => {
    const params = createAnthropicParams({
      apiKey: 'sk-test',
      baseURL: 'https://api.example.com/v1',
      models: { default: ['gpt-4o'] },
    });

    const options = await initializeCustom(params);

    expect(mockGetOpenAIConfig).toHaveBeenCalledWith(
      'sk-test',
      expect.any(Object),
      'Claude-Compatible',
    );
    expect(options.useLegacyContent).toBe(true);
    expect(options.provider).toBeUndefined();
  });
});
