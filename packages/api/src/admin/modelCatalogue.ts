import { logger, BASE_CONFIG_PRINCIPAL_ID } from '@librechat/data-schemas';
import {
  Constants,
  PrincipalType,
  PrincipalModel,
  extractEnvVariable,
} from 'librechat-data-provider';
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
  /**
   * Present only when the gateway answered and did not list this id — a typo, or a
   * model retired upstream. Employees can still select it and it fails on use.
   */
  unserved?: true;
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
  /**
   * False when the endpoint takes its line-up from its gateway (`models.fetch`):
   * the toggles below would be stored and audited but change nothing an employee
   * sees, so the screen must say so instead of offering them.
   */
  managed: boolean;
  models: AdminModelEntry[];
}

export interface ModelCatalogueResponse {
  endpoints: AdminModelEndpoint[];
}

/**
 * What a write actually changed, left on the request for the audit hook.
 *
 * The hook cannot read this off the request body: the body carries an intent, and
 * an intent that turned out to be a no-op must not be recorded as a change. Absent
 * means nothing was written.
 */
export interface ModelCatalogueChange {
  endpoint: string;
  model: string;
  enabled: boolean;
  /** The line-up as it stands after the change. */
  models: string[];
}

export interface ModelCatalogueDeps {
  getAppConfig: (options?: { tenantId?: string; refresh?: boolean }) => Promise<AppConfig>;
  /** Reads an endpoint's catalogue; `{}` when the gateway does not publish one. */
  fetchModelCapabilities: (params: {
    baseURL?: string;
    apiKey?: string;
  }) => Promise<ModelCapabilityMap>;
  /** Agents per model, so the UI can warn before retiring one that is in use. */
  countAgentsByModel: (provider: string, tenantId?: string) => Promise<Record<string, number>>;
  /**
   * The same gate `/api/admin/config` puts on the `endpoints` section. Without it
   * this route is a lower-privilege way to rewrite the very document that one
   * protects: `access:admin` alone would be enough to change what every employee
   * can select.
   */
  hasConfigCapability: (
    user: { id: string; role: string; tenantId?: string },
    section: string | null,
    verb?: 'manage' | 'read',
  ) => Promise<boolean>;
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
  models?: { default?: unknown; fetch?: unknown };
};

/**
 * Own-property membership, never `obj[key] != null`.
 *
 * These maps are built from gateway JSON and then looked up with ids from a
 * request body, so a plain index reads straight through `Object.prototype`:
 * `catalogue['toString']` is a function, not `undefined`, and an id like
 * `toString`, `constructor` or `__proto__` would pass "does the gateway serve
 * this" and be written into the live model list.
 */
const has = (map: object | undefined | null, key: string): boolean =>
  map != null && Object.prototype.hasOwnProperty.call(map, key);

/** Whether this endpoint takes its line-up from the gateway rather than the config. */
const fetchesItsOwnModels = (endpoint: CustomEndpoint): boolean => endpoint.models?.fetch === true;

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
): { roles: Map<string, ModelRole[]>; blocking: Set<string> } {
  const roles = new Map<string, ModelRole[]>();
  const blocking = new Set<string>();
  const add = (model: unknown, role: ModelRole, ambiguous = false) => {
    if (typeof model !== 'string' || model === '') {
      return;
    }
    /**
     * `current_model` is a setting, not a model: it tells the title step to reuse
     * whatever the conversation is on. Treated as an id it becomes a job held by
     * a model no gateway serves, and the endpoint can then never be saved —
     * dropping it fails the "still in use" check, keeping it fails the "served by
     * the gateway" one.
     */
    if (model === Constants.CURRENT_MODEL) {
      return;
    }
    const existing = roles.get(model);
    if (existing) {
      existing.push(role);
    } else {
      roles.set(model, [role]);
    }
    if (!ambiguous) {
      blocking.add(model);
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
  /**
   * With `deepResearch.endpoint` unset the roles belong to no endpoint in
   * particular, so they are shown against every endpoint that lists the id but
   * never block a save: an endpoint whose gateway does not serve the research
   * models would otherwise be unsavable in both directions.
   */
  const ambiguous = drEndpoint == null;
  if (ambiguous || drEndpoint === endpointName) {
    for (const [mode, tier] of Object.entries(deepResearch?.modes ?? {})) {
      add(tier?.leadModel, `deepResearch.${mode}.leadModel`, ambiguous);
      add(tier?.workerModel, `deepResearch.${mode}.workerModel`, ambiguous);
    }
  }

  return { roles, blocking };
}

/** Builds one endpoint's rows: catalogue order, enabled models hoisted to the top. */
function buildEndpoint(
  endpointName: string,
  configured: string[],
  catalogue: ModelCapabilityMap,
  roles: Map<string, ModelRole[]>,
  agentCounts: Record<string, number>,
  managed: boolean,
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
        ...configured.filter((id) => has(catalogue, id)),
        ...Object.keys(catalogue).filter((id) => !enabled.has(id)),
        ...configured.filter((id) => !has(catalogue, id)),
      ]
    : [...configured];

  const models = ids.map((id) => ({
    id,
    enabled: enabled.has(id),
    roles: roles.get(id) ?? [],
    agents: has(agentCounts, id) ? agentCounts[id] : 0,
    /**
     * Only ever `true`, and only when the gateway answered and left this id out:
     * employees can still select it and it will fail on use. A silent gateway
     * makes no such statement, so the field stays absent rather than claiming
     * every model is fine.
     */
    ...(answered && !has(catalogue, id) ? { unserved: true as const } : {}),
    ...(has(catalogue, id) ? catalogue[id] : {}),
  }));

  return { name: endpointName, source: answered ? 'catalogue' : 'config', managed, models };
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
    hasConfigCapability,
  } = deps;

  /** The catalogue only ever reads and writes `endpoints`. */
  const CONFIG_SECTION = 'endpoints';

  const denied = async (req: ServerRequest, verb: 'manage' | 'read'): Promise<boolean> => {
    const user = req.user as { id: string; role: string; tenantId?: string } | undefined;
    if (!user) {
      return true;
    }
    return !(await hasConfigCapability(user, CONFIG_SECTION, verb));
  };

  async function loadPayload(req: ServerRequest, refresh = false): Promise<ModelCatalogueResponse> {
    const tenantId = getTenantId(req);
    const appConfig = await getAppConfig({ tenantId, refresh });
    const endpoints = customEndpointsOf(appConfig);

    const rows = await Promise.all(
      endpoints.map(async (endpoint) => {
        const name = typeof endpoint.name === 'string' ? endpoint.name : '';
        if (name === '') {
          return null;
        }
        /** Independent reads — the agent aggregate need not wait for the catalogue. */
        const [catalogue, agentCounts] = await Promise.all([
          fetchModelCapabilities({
            baseURL: extractEnvVariable(String(endpoint.baseURL ?? '')),
            apiKey: extractEnvVariable(String(endpoint.apiKey ?? '')),
          }),
          countAgentsByModel(name, tenantId),
        ]);
        return buildEndpoint(
          name,
          configuredModelsOf(endpoint),
          catalogue,
          collectModelRoles(appConfig, name, endpoint).roles,
          agentCounts,
          !fetchesItsOwnModels(endpoint),
        );
      }),
    );

    return { endpoints: rows.filter((row): row is AdminModelEndpoint => row != null) };
  }

  async function getCatalogue(req: ServerRequest, res: Response): Promise<Response> {
    try {
      if (await denied(req, 'read')) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      return res.status(200).json(await loadPayload(req));
    } catch (error) {
      logger.error('[adminModelCatalogue] getCatalogue error:', error);
      return res.status(500).json({ error: 'Failed to load the model catalogue' });
    }
  }

  async function setModels(req: ServerRequest, res: Response): Promise<Response> {
    const audited = req as ServerRequest & { modelCatalogueChange?: ModelCatalogueChange };
    try {
      if (await denied(req, 'manage')) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      const {
        endpoint: endpointName,
        model,
        enabled,
      } = (req.body ?? {}) as {
        endpoint?: unknown;
        model?: unknown;
        enabled?: unknown;
      };
      if (typeof endpointName !== 'string' || endpointName === '') {
        return res.status(400).json({ error: 'endpoint is required' });
      }
      if (typeof model !== 'string' || model === '' || model.length > MAX_MODEL_ID_LENGTH) {
        return res.status(400).json({ error: 'model must be a model id' });
      }
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'enabled must be true or false' });
      }

      const tenantId = getTenantId(req);
      const appConfig = await getAppConfig({ tenantId });
      const endpoint = customEndpointsOf(appConfig).find((item) => item.name === endpointName);
      if (!endpoint) {
        return res.status(400).json({ error: `Unknown endpoint: ${endpointName}` });
      }
      /**
       * `models.fetch` makes the gateway's own list authoritative — `loadConfigModels`
       * uses `models.default` only when the fetch returns nothing. Accepting a
       * curated list here would store it, audit it and change nothing an employee
       * sees, so refuse instead of pretending.
       */
      if (fetchesItsOwnModels(endpoint)) {
        return res.status(400).json({
          error:
            `Endpoint "${endpointName}" takes its model list from its gateway ` +
            '(models.fetch), so a curated list here would have no effect. Set models.fetch ' +
            'to false in the configuration first.',
        });
      }

      /**
       * The change is applied to the list as it stands right now, never to a list the
       * caller sent.
       *
       * A caller that states the whole list states it from whatever it last read, so
       * an admin acting on a screen opened five minutes ago silently overwrites every
       * change made since — and no re-read on this side can tell that apart from an
       * intended edit. One model and a direction cannot carry a stale list, which also
       * makes the request idempotent (asking to enable what is already enabled is not
       * a change) and takes the order of the line-up out of the caller's hands: that
       * order decides what employees see first.
       */
      const current = configuredModelsOf(endpoint);
      const alreadyEnabled = current.includes(model);
      if (alreadyEnabled === enabled) {
        return res.status(200).json(await loadPayload(req));
      }
      const next = enabled ? [...current, model] : current.filter((id) => id !== model);

      if (next.length > MAX_MODELS_PER_ENDPOINT) {
        return res
          .status(400)
          .json({ error: `At most ${MAX_MODELS_PER_ENDPOINT} models per endpoint` });
      }
      /**
       * An empty list is refused rather than accepted-and-guarded-on-read: the
       * merged config would carry `[]`, the model selector would be empty and
       * nobody could start a chat. Forbidding the state beats detecting it.
       */
      if (next.length === 0) {
        return res.status(400).json({ error: 'At least one model must stay enabled' });
      }

      if (enabled) {
        const catalogue = await fetchModelCapabilities({
          baseURL: extractEnvVariable(String(endpoint.baseURL ?? '')),
          apiKey: extractEnvVariable(String(endpoint.apiKey ?? '')),
        });
        /** Checked only when there is a catalogue to check against — otherwise every
         *  id would look invalid and the endpoint would become unmanageable. */
        if (Object.keys(catalogue).length > 0 && !has(catalogue, model)) {
          return res.status(400).json({
            error: `Not served by this endpoint's gateway: ${model}`,
          });
        }
      } else {
        /**
         * A model holding a configuration job cannot be dropped here. Doing so would
         * break new chats, titles or Deep Research for everyone at once, and the
         * admin cannot see that from this screen — so the error names the model and
         * the setting to change first.
         */
        const { roles, blocking: claimed } = collectModelRoles(appConfig, endpointName, endpoint);
        if (claimed.has(model)) {
          return res.status(400).json({
            error:
              'Still in use by configuration — change that setting first: ' +
              `${model} (${(roles.get(model) ?? []).join(', ')})`,
          });
        }
      }

      /**
       * `includeInactive` matters: the read decides what the write preserves. A
       * deactivated base document reads back as null without it, the merge then
       * starts from an empty array, and the `$set` replaces every other endpoint's
       * saved list with this one — the clobber `mergeEndpointOverride` exists to
       * prevent.
       */
      const stored = await findConfigByPrincipal(PrincipalType.ROLE, BASE_CONFIG_PRINCIPAL_ID, {
        includeInactive: true,
      });
      const overrides = (stored?.overrides ?? {}) as { endpoints?: { custom?: unknown } };
      const merged = mergeEndpointOverride(overrides.endpoints?.custom, endpointName, next);

      /**
       * The whole array is rewritten, so a save that started from a stale read
       * would silently drop a sibling endpoint another admin had just changed.
       * There is no transaction to lean on — the deployment runs a standalone
       * mongod — so re-read immediately before writing and refuse rather than
       * overwrite. It narrows the window to one round trip and turns a silent
       * loss into something the admin can retry.
       */
      const fresh = await findConfigByPrincipal(PrincipalType.ROLE, BASE_CONFIG_PRINCIPAL_ID, {
        includeInactive: true,
      });
      const freshCustom = ((fresh?.overrides ?? {}) as { endpoints?: { custom?: unknown } })
        .endpoints?.custom;
      if (
        JSON.stringify(freshCustom ?? null) !== JSON.stringify(overrides.endpoints?.custom ?? null)
      ) {
        return res.status(409).json({
          error: 'The model lists changed while this was being saved. Reload and try again.',
        });
      }

      await patchConfigFields(
        PrincipalType.ROLE,
        BASE_CONFIG_PRINCIPAL_ID,
        PrincipalModel.ROLE,
        { [CUSTOM_ENDPOINTS_FIELD]: merged },
        MODEL_CATALOGUE_PRIORITY,
      );
      /**
       * The journal is told what was actually written, not what was asked for: a
       * request that changed nothing returns above without reaching this line, so an
       * entry always describes a real change, and the list it records is the one the
       * server produced rather than one a caller claimed.
       */
      audited.modelCatalogueChange = { endpoint: endpointName, model, enabled, models: next };
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
