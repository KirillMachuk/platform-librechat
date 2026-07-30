import { logger, BASE_CONFIG_PRINCIPAL_ID } from '@librechat/data-schemas';
import { PrincipalType, PrincipalModel, extractEnvVariable } from 'librechat-data-provider';
import type { ModelCapabilities, ModelCapabilityMap } from 'librechat-data-provider';
import type { AppConfig, IConfig } from '@librechat/data-schemas';
import type { Types, ClientSession } from 'mongoose';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';

/**
 * Which models an endpoint offers, curated from the gateway's own catalogue.
 *
 * A model line-up changes weekly, and until now adding one meant editing
 * `librechat.yaml` and redeploying. The gateway already publishes everything it
 * serves, and the config-override machinery already applies YAML changes from the
 * database without a redeploy — so an admin can pick from the full catalogue and
 * have the choice take effect on the next request.
 *
 * The list is written as an override on the base principal, merged into
 * `endpoints.custom` by endpoint `name`; a nested `models.default` array replaces
 * the YAML one wholesale, while every other field of the endpoint (baseURL, key,
 * dropParams) keeps coming from YAML.
 */

/**
 * Priority of the tenant-wide override. Must match `DEEP_RESEARCH_PRIORITY`: both
 * write to the same base-principal document, and `patchConfigFields` stamps the
 * priority on it, so differing values would flip it on every write.
 */
const MODEL_CATALOGUE_PRIORITY = 10;

/** Dot-path of the custom-endpoints array within the config override document. */
const CUSTOM_ENDPOINTS_FIELD = 'endpoints.custom';

/**
 * Ceiling on how many models one endpoint may offer.
 *
 * Not a product limit — a blast radius. The list is persisted, echoed into every
 * audit entry, and delivered to every client with the endpoints config, so an
 * accidental or scripted oversized request would inflate all three at once.
 * Comfortably above any real catalogue (OpenRouter serves under 400), and a
 * curated line-up is an order of magnitude smaller still.
 */
const MAX_MODELS_PER_ENDPOINT = 1000;

/**
 * Ceiling on one model id. Ids are `vendor/model[:tag]`; the longest in a real
 * catalogue is well under a hundred characters.
 */
const MAX_MODEL_ID_LENGTH = 200;

/** A job this model does in the configuration; switching it off breaks that job. */
export type ModelRole =
  | 'defaultModel'
  | 'titleModel'
  | `deepResearch.${string}.leadModel`
  | `deepResearch.${string}.workerModel`;

export interface AdminModelEntry extends ModelCapabilities {
  id: string;
  /** Offered to employees right now. */
  enabled: boolean;
  /** Configuration jobs this model holds — non-empty means it cannot be switched off. */
  roles: ModelRole[];
  /** Agents pinned to this model; they break when it stops being offered. */
  agents: number;
}

export interface AdminModelEndpoint {
  name: string;
  /**
   * `catalogue` when the gateway published what it serves, so the full list is
   * pickable. `config` when it did not — then only the configured models are
   * listed and the screen is read-mostly, because we cannot tell a typo from a
   * model the gateway simply did not mention.
   */
  source: 'catalogue' | 'config';
  models: AdminModelEntry[];
}

export interface ModelCatalogueResponse {
  endpoints: AdminModelEndpoint[];
}

export interface ModelCatalogueDeps {
  getAppConfig: (options?: { tenantId?: string; refresh?: boolean }) => Promise<AppConfig>;
  /** Reads an endpoint's catalogue; `{}` when the gateway does not publish one. */
  fetchModelCapabilities: (params: {
    baseURL?: string;
    apiKey?: string;
  }) => Promise<ModelCapabilityMap>;
  /** Agents per model, so the UI can warn before retiring one that is in use. */
  countAgentsByModel: (tenantId?: string) => Promise<Record<string, number>>;
  /** The raw override document, to avoid clobbering a sibling endpoint's list. */
  findConfigByPrincipal: (
    principalType: PrincipalType,
    principalId: string | Types.ObjectId,
    options?: { includeInactive?: boolean },
    session?: ClientSession,
  ) => Promise<IConfig | null>;
  patchConfigFields: (
    principalType: PrincipalType,
    principalId: string | Types.ObjectId,
    principalModel: PrincipalModel,
    fields: Record<string, unknown>,
    priority: number,
    session?: ClientSession,
  ) => Promise<unknown>;
  invalidateConfigCaches?: (tenantId?: string) => Promise<void>;
}

type CustomEndpoint = {
  name?: unknown;
  baseURL?: unknown;
  apiKey?: unknown;
  titleModel?: unknown;
  models?: { default?: unknown };
};

function getTenantId(req: ServerRequest): string | undefined {
  return (req.user as { tenantId?: string } | undefined)?.tenantId;
}

function customEndpointsOf(appConfig: AppConfig): CustomEndpoint[] {
  const custom = appConfig?.endpoints?.custom;
  return Array.isArray(custom) ? (custom as CustomEndpoint[]) : [];
}

const configuredModelsOf = (endpoint: CustomEndpoint): string[] =>
  Array.isArray(endpoint.models?.default)
    ? (endpoint.models.default as unknown[]).filter(
        (model): model is string => typeof model === 'string' && model !== '',
      )
    : [];

/**
 * The configuration jobs held by models of one endpoint.
 *
 * Only jobs that are pinned to a *model id* count. `interface.defaultModel` also
 * names an endpoint, so it is attributed to that endpoint alone; Deep Research
 * roles belong to `deepResearch.endpoint` when set, and are otherwise ambiguous
 * across endpoints — in that case they are reported everywhere the id appears,
 * which errs toward warning rather than silence.
 */
export function collectModelRoles(
  appConfig: AppConfig,
  endpointName: string,
  endpoint: CustomEndpoint,
): Map<string, ModelRole[]> {
  const roles = new Map<string, ModelRole[]>();
  const add = (model: unknown, role: ModelRole) => {
    if (typeof model !== 'string' || model === '') {
      return;
    }
    const existing = roles.get(model);
    if (existing) {
      existing.push(role);
    } else {
      roles.set(model, [role]);
    }
  };

  const defaultModel = appConfig?.interfaceConfig?.defaultModel as
    | { endpoint?: string; model?: string }
    | undefined;
  if (defaultModel?.endpoint === endpointName) {
    add(defaultModel.model, 'defaultModel');
  }

  add(endpoint.titleModel, 'titleModel');

  const deepResearch = appConfig?.deepResearch as
    | {
        endpoint?: string;
        modes?: Record<string, { leadModel?: unknown; workerModel?: unknown }>;
      }
    | undefined;
  const drEndpoint = deepResearch?.endpoint;
  if (drEndpoint == null || drEndpoint === endpointName) {
    for (const [mode, tier] of Object.entries(deepResearch?.modes ?? {})) {
      add(tier?.leadModel, `deepResearch.${mode}.leadModel`);
      add(tier?.workerModel, `deepResearch.${mode}.workerModel`);
    }
  }

  return roles;
}

/** Builds one endpoint's rows: catalogue order, enabled models hoisted to the top. */
function buildEndpoint(
  endpointName: string,
  configured: string[],
  catalogue: ModelCapabilityMap,
  roles: Map<string, ModelRole[]>,
  agentCounts: Record<string, number>,
): AdminModelEndpoint {
  const answered = Object.keys(catalogue).length > 0;
  const enabled = new Set(configured);
  /**
   * Configured models the gateway does not list are kept and shown as enabled:
   * hiding them would make the screen lie about what employees can pick, and it
   * is exactly the state an operator needs to see (typo, or retired upstream).
   */
  const ids = answered
    ? [
        ...configured.filter((id) => catalogue[id] != null),
        ...Object.keys(catalogue).filter((id) => !enabled.has(id)),
        ...configured.filter((id) => catalogue[id] == null),
      ]
    : [...configured];

  const models = ids.map((id) => ({
    id,
    enabled: enabled.has(id),
    roles: roles.get(id) ?? [],
    agents: agentCounts[id] ?? 0,
    ...(catalogue[id] ?? {}),
  }));

  return { name: endpointName, source: answered ? 'catalogue' : 'config', models };
}

/**
 * Merges one endpoint's model list into the existing override array.
 *
 * Reads the stored override rather than rebuilding it from the merged config: a
 * blind overwrite would drop a sibling endpoint's list, and restating every
 * endpoint would silently freeze lists nobody asked to change (a later YAML edit
 * to those would then look ignored).
 */
export function mergeEndpointOverride(
  stored: unknown,
  endpointName: string,
  models: string[],
): Array<Record<string, unknown>> {
  const entries = Array.isArray(stored) ? (stored as Array<Record<string, unknown>>) : [];
  const next = entries.map((entry) =>
    entry?.name === endpointName
      ? { ...entry, models: { ...(entry.models as object), default: models } }
      : entry,
  );
  if (!next.some((entry) => entry?.name === endpointName)) {
    next.push({ name: endpointName, models: { default: models } });
  }
  return next;
}

export function createModelCatalogueHandlers(deps: ModelCatalogueDeps): {
  getCatalogue: (req: ServerRequest, res: Response) => Promise<Response>;
  setModels: (req: ServerRequest, res: Response) => Promise<Response>;
} {
  const {
    getAppConfig,
    fetchModelCapabilities,
    countAgentsByModel,
    findConfigByPrincipal,
    patchConfigFields,
    invalidateConfigCaches,
  } = deps;

  async function loadPayload(req: ServerRequest, refresh = false): Promise<ModelCatalogueResponse> {
    const tenantId = getTenantId(req);
    const appConfig = await getAppConfig({ tenantId, refresh });
    const endpoints = customEndpointsOf(appConfig);
    const agentCounts = await countAgentsByModel(tenantId);

    const rows = await Promise.all(
      endpoints.map(async (endpoint) => {
        const name = typeof endpoint.name === 'string' ? endpoint.name : '';
        if (name === '') {
          return null;
        }
        const catalogue = await fetchModelCapabilities({
          baseURL: extractEnvVariable(String(endpoint.baseURL ?? '')),
          apiKey: extractEnvVariable(String(endpoint.apiKey ?? '')),
        });
        return buildEndpoint(
          name,
          configuredModelsOf(endpoint),
          catalogue,
          collectModelRoles(appConfig, name, endpoint),
          agentCounts,
        );
      }),
    );

    return { endpoints: rows.filter((row): row is AdminModelEndpoint => row != null) };
  }

  async function getCatalogue(req: ServerRequest, res: Response): Promise<Response> {
    try {
      return res.status(200).json(await loadPayload(req));
    } catch (error) {
      logger.error('[adminModelCatalogue] getCatalogue error:', error);
      return res.status(500).json({ error: 'Failed to load the model catalogue' });
    }
  }

  async function setModels(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const { endpoint: endpointName, models } = (req.body ?? {}) as {
        endpoint?: unknown;
        models?: unknown;
      };
      if (typeof endpointName !== 'string' || endpointName === '') {
        return res.status(400).json({ error: 'endpoint is required' });
      }
      if (
        !Array.isArray(models) ||
        models.some(
          (m) => typeof m !== 'string' || m === '' || (m as string).length > MAX_MODEL_ID_LENGTH,
        )
      ) {
        return res.status(400).json({ error: 'models must be an array of model ids' });
      }
      if (models.length > MAX_MODELS_PER_ENDPOINT) {
        return res
          .status(400)
          .json({ error: `At most ${MAX_MODELS_PER_ENDPOINT} models per endpoint` });
      }
      const unique = [...new Set(models as string[])];
      if (unique.length !== models.length) {
        return res.status(400).json({ error: 'models must not repeat' });
      }
      /**
       * An empty list is refused rather than accepted-and-guarded-on-read: the
       * merged config would carry `[]`, the model selector would be empty and
       * nobody could start a chat. Forbidding the state beats detecting it.
       */
      if (unique.length === 0) {
        return res.status(400).json({ error: 'At least one model must stay enabled' });
      }

      const tenantId = getTenantId(req);
      const appConfig = await getAppConfig({ tenantId });
      const endpoint = customEndpointsOf(appConfig).find((item) => item.name === endpointName);
      if (!endpoint) {
        return res.status(400).json({ error: `Unknown endpoint: ${endpointName}` });
      }

      const catalogue = await fetchModelCapabilities({
        baseURL: extractEnvVariable(String(endpoint.baseURL ?? '')),
        apiKey: extractEnvVariable(String(endpoint.apiKey ?? '')),
      });
      /** Only validate against the catalogue when there is one — otherwise every
       *  id would look invalid and the endpoint would become unmanageable. */
      if (Object.keys(catalogue).length > 0) {
        const unknown = unique.filter((model) => catalogue[model] == null);
        if (unknown.length > 0) {
          return res.status(400).json({
            error: `Not served by this endpoint's gateway: ${unknown.join(', ')}`,
          });
        }
      }

      /**
       * Models holding a configuration job cannot be dropped here. Doing so would
       * break new chats, titles or Deep Research for everyone at once, and the
       * admin cannot see that from this screen — so the error names the model and
       * the setting to change first.
       */
      const roles = collectModelRoles(appConfig, endpointName, endpoint);
      const stillEnabled = new Set(unique);
      const blocking = [...roles.entries()].filter(([model]) => !stillEnabled.has(model));
      if (blocking.length > 0) {
        return res.status(400).json({
          error: `Still in use by configuration — change that setting first: ${blocking
            .map(([model, jobs]) => `${model} (${jobs.join(', ')})`)
            .join('; ')}`,
        });
      }

      const stored = await findConfigByPrincipal(PrincipalType.ROLE, BASE_CONFIG_PRINCIPAL_ID);
      const overrides = (stored?.overrides ?? {}) as { endpoints?: { custom?: unknown } };
      await patchConfigFields(
        PrincipalType.ROLE,
        BASE_CONFIG_PRINCIPAL_ID,
        PrincipalModel.ROLE,
        {
          [CUSTOM_ENDPOINTS_FIELD]: mergeEndpointOverride(
            overrides.endpoints?.custom,
            endpointName,
            unique,
          ),
        },
        MODEL_CATALOGUE_PRIORITY,
      );
      if (invalidateConfigCaches) {
        await invalidateConfigCaches(tenantId);
      }
      return res.status(200).json(await loadPayload(req, true));
    } catch (error) {
      logger.error('[adminModelCatalogue] setModels error:', error);
      return res.status(500).json({ error: 'Failed to update the model list' });
    }
  }

  return { getCatalogue, setModels };
}
