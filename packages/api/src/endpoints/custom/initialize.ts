import {
  ErrorTypes,
  envVarRegex,
  KnownEndpoints,
  FetchTokenConfig,
  extractEnvVariable,
} from 'librechat-data-provider';
import type { TEndpoint } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { BaseInitializeParams, InitializeResultBase, EndpointTokenConfig } from '~/types';
import { getOpenAIConfig } from '~/endpoints/openai/config';
import { isUserProvided, checkUserKeyExpiry } from '~/utils';
import { getCustomEndpointConfig } from '~/app/config';
import { fetchModels } from '~/endpoints/models';
import { validateEndpointURL } from '~/auth';
import { tokenConfigCache } from '~/cache';

const { PROXY } = process.env;

/** True when a value points at OpenRouter (by endpoint name or baseURL). */
function includesOpenRouter(value?: string | null): boolean {
  return typeof value === 'string' && value.toLowerCase().includes(KnownEndpoints.openrouter);
}

/**
 * Builds custom options from endpoint configuration
 */
function buildCustomOptions(
  endpointConfig: Partial<TEndpoint>,
  appConfig?: AppConfig,
  endpointTokenConfig?: Record<string, unknown>,
) {
  const customOptions: Record<string, unknown> = {
    headers: endpointConfig.headers,
    addParams: endpointConfig.addParams,
    dropParams: endpointConfig.dropParams,
    customParams: endpointConfig.customParams,
    titleConvo: endpointConfig.titleConvo,
    titleModel: endpointConfig.titleModel,
    modelDisplayLabel: endpointConfig.modelDisplayLabel,
    titleMethod: endpointConfig.titleMethod ?? 'completion',
    directEndpoint: endpointConfig.directEndpoint,
    titleMessageRole: endpointConfig.titleMessageRole,
    streamRate: endpointConfig.streamRate,
    endpointTokenConfig,
  };

  const allConfig = appConfig?.endpoints?.all;
  if (allConfig) {
    customOptions.streamRate = allConfig.streamRate;
  }

  return customOptions;
}

/**
 * Initializes a custom endpoint client configuration.
 * This function handles custom endpoints defined in librechat.yaml, including
 * user-provided API keys and URLs.
 *
 * @param params - Configuration parameters
 * @returns Promise resolving to endpoint configuration options
 * @throws Error if config is missing, API key is not provided, or base URL is missing
 */
export async function initializeCustom({
  req,
  endpoint,
  model_parameters,
  db,
}: BaseInitializeParams): Promise<InitializeResultBase> {
  const appConfig = req.config;
  const { key: expiresAt } = req.body;

  const endpointConfig = getCustomEndpointConfig({
    endpoint,
    appConfig,
  });

  if (!endpointConfig) {
    throw new Error(`Config not found for the ${endpoint} custom endpoint.`);
  }

  const CUSTOM_API_KEY = extractEnvVariable(endpointConfig.apiKey ?? '');
  const CUSTOM_BASE_URL = extractEnvVariable(endpointConfig.baseURL ?? '');

  if (CUSTOM_API_KEY.match(envVarRegex)) {
    throw new Error(`Missing API Key for ${endpoint}.`);
  }

  if (CUSTOM_BASE_URL.match(envVarRegex)) {
    throw new Error(`Missing Base URL for ${endpoint}.`);
  }

  const userProvidesKey = isUserProvided(CUSTOM_API_KEY);
  const userProvidesURL = isUserProvided(CUSTOM_BASE_URL);

  // Expiry is only checked when present: the Agents API sends an OpenAI-compatible
  // request body that does not include `key` (the expiry timestamp), so expiresAt
  // will be undefined in that flow. The key is still fetched regardless.
  if (expiresAt && (userProvidesKey || userProvidesURL)) {
    checkUserKeyExpiry(expiresAt, endpoint);
  }

  let userValues = null;
  if (userProvidesKey || userProvidesURL) {
    userValues = await db.getUserKeyValues({ userId: req.user?.id ?? '', name: endpoint });
  }

  const apiKey = userProvidesKey ? userValues?.apiKey : CUSTOM_API_KEY;
  const baseURL = userProvidesURL ? userValues?.baseURL : CUSTOM_BASE_URL;

  if (userProvidesKey && !apiKey) {
    throw new Error(
      JSON.stringify({
        type: ErrorTypes.NO_USER_KEY,
      }),
    );
  }

  if (userProvidesURL && !baseURL) {
    throw new Error(
      JSON.stringify({
        type: ErrorTypes.NO_BASE_URL,
      }),
    );
  }

  if (!apiKey) {
    throw new Error(`${endpoint} API key not provided.`);
  }

  if (!baseURL) {
    throw new Error(`${endpoint} Base URL not provided.`);
  }

  if (userProvidesURL) {
    await validateEndpointURL(baseURL, endpoint, appConfig?.endpoints?.allowedAddresses);
  }

  let endpointTokenConfig: EndpointTokenConfig | undefined;

  const userId = req.user?.id ?? '';

  const cache = tokenConfigCache();
  /** tokenConfig is an optional extended property on custom endpoints */
  const hasTokenConfig = (endpointConfig as Record<string, unknown>).tokenConfig != null;
  const tokenKey =
    !hasTokenConfig && (userProvidesKey || userProvidesURL) ? `${endpoint}:${userId}` : endpoint;

  /**
   * Pull live per-model token limits (context window + pricing) from the
   * provider's `/models` endpoint when it's OpenRouter-backed. We detect
   * OpenRouter by baseURL — not only by the endpoint name — so a white-labeled
   * endpoint (e.g. renamed from "openrouter" to "1ma") still gets real limits
   * instead of silently falling back to the hardcoded token maps. This is
   * intentionally decoupled from `models.fetch` (which controls the *displayed*
   * model list) so the curated menu stays intact. On any failure
   * `endpointTokenConfig` stays undefined and callers fall back to the static
   * maps — identical to the previous behavior.
   */
  const shouldFetchTokenConfig =
    !hasTokenConfig &&
    (Boolean(FetchTokenConfig[endpoint.toLowerCase() as keyof typeof FetchTokenConfig]) ||
      includesOpenRouter(baseURL));

  const cachedConfig = shouldFetchTokenConfig && (await cache.get(tokenKey));
  endpointTokenConfig = (cachedConfig as EndpointTokenConfig) || undefined;

  if (shouldFetchTokenConfig && endpointConfig && !endpointTokenConfig) {
    await fetchModels({ apiKey, baseURL, name: endpoint, user: userId, tokenKey });
    endpointTokenConfig = (await cache.get(tokenKey)) as EndpointTokenConfig | undefined;
  }

  const customOptions = buildCustomOptions(endpointConfig, appConfig, endpointTokenConfig);

  const clientOptions: Record<string, unknown> = {
    reverseProxyUrl: baseURL ?? null,
    proxy: PROXY ?? null,
    ...customOptions,
  };

  const modelOptions = { ...(model_parameters ?? {}), user: userId };
  const finalClientOptions = {
    modelOptions,
    ...clientOptions,
  };

  const options = getOpenAIConfig(apiKey, finalClientOptions, endpoint);
  if (options != null) {
    (options as InitializeResultBase).useLegacyContent = true;
    (options as InitializeResultBase).endpointTokenConfig = endpointTokenConfig;
  }

  const streamRate = clientOptions.streamRate as number | undefined;
  if (streamRate) {
    (options.llmConfig as Record<string, unknown>)._lc_stream_delay = streamRate;
  }

  return options;
}
