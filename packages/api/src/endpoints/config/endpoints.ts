import {
  AuthType,
  EModelEndpoint,
  isAgentsEndpoint,
  extractEnvVariable,
  orderEndpointsConfig,
  normalizeEndpointName,
  defaultAgentCapabilities,
} from 'librechat-data-provider';
import type {
  TConfig,
  AgentCapabilities,
  TEndpointsConfig,
  ModelCapabilities,
} from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { ServerRequest, TCustomEndpointsConfig } from '~/types';
import { loadCustomEndpointsConfig as defaultLoadCustomEndpoints } from '~/endpoints/custom';
import { fetchModelCapabilities } from '~/endpoints/modelCapabilities';
import { publishModelLimits } from '~/utils/tokens';

/**
 * What the browser is told about a model, out of everything the catalogue read
 * carries.
 *
 * The read also collects fields only the admin screen needs — release and
 * retirement dates, what an alias resolves to, whether it is a free variant — and
 * this map rides on a route rebuilt several times per message. For an endpoint
 * without a curated list that is the entire catalogue, every time, so the extra
 * fields would be tens of kB of JSON per message answering nothing the browser
 * asks. The token figures stay: callers already had them.
 */
const forTheBrowser = ({
  vision,
  tools,
  contextTokens,
  maxOutputTokens,
  name,
}: ModelCapabilities): ModelCapabilities => ({
  vision,
  tools,
  contextTokens,
  maxOutputTokens,
  name,
});

type PartialEndpointEntry = Partial<TConfig> & Record<string, unknown>;
type DefaultEndpointsResult = Record<string, PartialEndpointEntry | false | null>;
type MutableEndpointsConfig = Record<string, PartialEndpointEntry | false | null | undefined>;

export interface EndpointsConfigDeps {
  getAppConfig: (params: {
    role?: string;
    userId?: string;
    tenantId?: string;
  }) => Promise<AppConfig>;
  loadDefaultEndpointsConfig: (appConfig: AppConfig) => Promise<DefaultEndpointsResult>;
  loadCustomEndpointsConfig?: (custom: unknown) => TCustomEndpointsConfig | undefined;
}

/**
 * Annotates each custom endpoint with what its gateway says its models can do.
 *
 * Consumers decided capabilities from hand-maintained lists of model-name
 * substrings — which go stale every time the line-up changes, and whose stale
 * answer tells people their working model is broken. Where the gateway publishes
 * a catalogue, that is the answer; where it does not, the field stays absent and
 * consumers keep matching on names as before.
 *
 * Answers are cached, and failures are swallowed inside `fetchModelCapabilities`
 * — the endpoints config must not depend on the gateway being reachable.
 */
async function attachModelCapabilities(
  customEndpointsConfig: TCustomEndpointsConfig | undefined,
  customEndpoints: unknown,
): Promise<void> {
  if (!customEndpointsConfig || !Array.isArray(customEndpoints)) {
    return;
  }

  await Promise.all(
    (customEndpoints as Array<Record<string, unknown>>).map(async (endpoint) => {
      const configName = endpoint?.name;
      if (typeof configName !== 'string') {
        return;
      }
      const entry = customEndpointsConfig[normalizeEndpointName(configName)];
      if (!entry) {
        return;
      }
      /**
       * `models.default` legally holds `{ name, description }` objects as well as
       * plain ids (`modelItemSchema`), and `loadConfigModels` already reads both.
       * Casting the array to `string[]` made every entry of an object-form list
       * miss in the capability map, so the whole feature switched itself off for
       * that endpoint without a word.
       */
      const configured = (endpoint.models as { default?: unknown } | undefined)?.default;
      const configuredModels = Array.isArray(configured)
        ? configured
            .map((model) =>
              typeof model === 'string' ? model : (model as { name?: unknown } | null)?.name,
            )
            .filter((model): model is string => typeof model === 'string' && model !== '')
        : undefined;
      const modelCapabilities = await fetchModelCapabilities({
        baseURL: extractEnvVariable(String(endpoint.baseURL ?? '')),
        apiKey: extractEnvVariable(String(endpoint.apiKey ?? '')),
        configuredModels,
      });
      if (Object.keys(modelCapabilities).length === 0) {
        return;
      }
      /** Token limits are also needed deep in server code that cannot await a
       *  gateway (`getModelMaxTokens` is synchronous), so publish them for it —
       *  the whole catalogue, since a model can be selected before it appears in
       *  a curated list. */
      publishModelLimits(configName, modelCapabilities);
      /**
       * The client only ever asks about models it can select, so send those and
       * not the gateway's whole catalogue: a few hundred models weigh tens of kB
       * of JSON on a route rebuilt on every message, against ~1 kB for a curated
       * line-up.
       */
      entry.modelCapabilities = Object.fromEntries(
        (configuredModels ?? Object.keys(modelCapabilities))
          .filter((model) => modelCapabilities[model] != null)
          .map((model) => [model, forTheBrowser(modelCapabilities[model])]),
      );
    }),
  );
}

export function createEndpointsConfigService(deps: EndpointsConfigDeps): {
  getEndpointsConfig: (req: ServerRequest) => Promise<TEndpointsConfig>;
  checkCapability: (req: ServerRequest, capability: AgentCapabilities) => Promise<boolean>;
} {
  const {
    getAppConfig,
    loadDefaultEndpointsConfig,
    loadCustomEndpointsConfig = defaultLoadCustomEndpoints,
  } = deps;

  async function getEndpointsConfig(req: ServerRequest): Promise<TEndpointsConfig> {
    const appConfig =
      req.config ??
      (await getAppConfig({
        role: req.user?.role,
        userId: req.user?.id,
        tenantId: req.user?.tenantId,
      }));
    const defaultEndpointsConfig = await loadDefaultEndpointsConfig(appConfig);
    const customEndpointsConfig = loadCustomEndpointsConfig(appConfig?.endpoints?.custom);
    await attachModelCapabilities(customEndpointsConfig, appConfig?.endpoints?.custom);

    const mergedConfig: MutableEndpointsConfig = {
      ...defaultEndpointsConfig,
      ...customEndpointsConfig,
    };

    if (appConfig.endpoints?.[EModelEndpoint.azureOpenAI]) {
      mergedConfig[EModelEndpoint.azureOpenAI] = { userProvide: false };
    }

    if (appConfig.endpoints?.[EModelEndpoint.anthropic]?.vertexConfig?.enabled) {
      mergedConfig[EModelEndpoint.anthropic] = { userProvide: false };
    }

    if (appConfig.endpoints?.[EModelEndpoint.azureOpenAI]?.assistants) {
      mergedConfig[EModelEndpoint.azureAssistants] = { userProvide: false };
    }

    if (
      mergedConfig[EModelEndpoint.assistants] &&
      appConfig?.endpoints?.[EModelEndpoint.assistants]
    ) {
      const { disableBuilder, retrievalModels, capabilities, version } =
        appConfig.endpoints[EModelEndpoint.assistants];
      mergedConfig[EModelEndpoint.assistants] = {
        ...mergedConfig[EModelEndpoint.assistants],
        version: version != null ? String(version) : undefined,
        retrievalModels,
        disableBuilder,
        capabilities,
      };
    }

    if (mergedConfig[EModelEndpoint.agents] && appConfig?.endpoints?.[EModelEndpoint.agents]) {
      const { disableBuilder, capabilities, allowedProviders } =
        appConfig.endpoints[EModelEndpoint.agents];
      mergedConfig[EModelEndpoint.agents] = {
        ...mergedConfig[EModelEndpoint.agents],
        allowedProviders,
        disableBuilder,
        capabilities,
      };
    }

    if (
      mergedConfig[EModelEndpoint.azureAssistants] &&
      appConfig?.endpoints?.[EModelEndpoint.azureAssistants]
    ) {
      const { disableBuilder, retrievalModels, capabilities, version } =
        appConfig.endpoints[EModelEndpoint.azureAssistants];
      mergedConfig[EModelEndpoint.azureAssistants] = {
        ...mergedConfig[EModelEndpoint.azureAssistants],
        version: version != null ? String(version) : undefined,
        retrievalModels,
        disableBuilder,
        capabilities,
      };
    }

    if (mergedConfig[EModelEndpoint.bedrock] && appConfig?.endpoints?.[EModelEndpoint.bedrock]) {
      const { availableRegions } = appConfig.endpoints[EModelEndpoint.bedrock] as {
        availableRegions?: string[];
      };
      mergedConfig[EModelEndpoint.bedrock] = {
        ...mergedConfig[EModelEndpoint.bedrock],
        availableRegions,
      };
    }

    if (mergedConfig[EModelEndpoint.bedrock]) {
      mergedConfig[EModelEndpoint.bedrock] = {
        ...mergedConfig[EModelEndpoint.bedrock],
        userProvideAccessKeyId: process.env.BEDROCK_AWS_ACCESS_KEY_ID === AuthType.USER_PROVIDED,
        userProvideSecretAccessKey:
          process.env.BEDROCK_AWS_SECRET_ACCESS_KEY === AuthType.USER_PROVIDED,
        userProvideSessionToken: process.env.BEDROCK_AWS_SESSION_TOKEN === AuthType.USER_PROVIDED,
        userProvideBearerToken: process.env.BEDROCK_AWS_BEARER_TOKEN === AuthType.USER_PROVIDED,
      };
    }

    return orderEndpointsConfig(mergedConfig as TEndpointsConfig);
  }

  async function checkCapability(
    req: ServerRequest,
    capability: AgentCapabilities,
  ): Promise<boolean> {
    const isAgents = isAgentsEndpoint(req.body?.endpointType || req.body?.endpoint);
    const endpointsConfig = await getEndpointsConfig(req);
    const capabilities =
      isAgents || endpointsConfig?.[EModelEndpoint.agents]?.capabilities != null
        ? (endpointsConfig?.[EModelEndpoint.agents]?.capabilities ?? [])
        : defaultAgentCapabilities;
    return capabilities.includes(capability);
  }

  return { getEndpointsConfig, checkCapability };
}
