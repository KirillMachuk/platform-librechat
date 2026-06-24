import { logger, BASE_CONFIG_PRINCIPAL_ID } from '@librechat/data-schemas';
import { PrincipalType, PrincipalModel, DeepResearchModes } from 'librechat-data-provider';
import type { DeepResearchMode } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { Types, ClientSession } from 'mongoose';
import type { Response } from 'express';
import type { ResolvedDeepResearchMode } from '../deepResearch';
import type { ServerRequest } from '~/types/http';
import { isReasoningModel, resolveDeepResearchMode } from '../deepResearch';

/** Priority of the tenant-wide Deep Research override; matches the admin config default. */
const DEEP_RESEARCH_PRIORITY = 10;

/** Dot-path of the activeMode field within the config override document. */
const ACTIVE_MODE_FIELD = 'deepResearch.activeMode';

export interface DeepResearchSettingsResponse {
  activeMode: DeepResearchMode;
  /** Resolved caps + models for every depth tier (for display in the admin UI). */
  modes: ResolvedDeepResearchMode[];
  /** Models available across the tenant's endpoints — the valid lead/worker choices. */
  availableModels: string[];
}

export interface DeepResearchSettingsDeps {
  /** Returns the merged AppConfig (YAML base + DB overrides) for the tenant. */
  getAppConfig: (options?: { tenantId?: string; refresh?: boolean }) => Promise<AppConfig>;
  /** Returns the per-endpoint available-models map ({ [endpoint]: string[] }). */
  getModelsConfig: (req: ServerRequest) => Promise<Record<string, string[]> | null | undefined>;
  /** Patches individual config fields by dot-path on a principal's override document. */
  patchConfigFields: (
    principalType: PrincipalType,
    principalId: string | Types.ObjectId,
    principalModel: PrincipalModel,
    fields: Record<string, unknown>,
    priority: number,
    session?: ClientSession,
  ) => Promise<unknown>;
  /** Invalidate config caches so the change applies to subsequent requests. */
  invalidateConfigCaches?: (tenantId?: string) => Promise<void>;
}

function getTenantId(req: ServerRequest): string | undefined {
  return (req.user as { tenantId?: string } | undefined)?.tenantId;
}

/**
 * The valid lead/worker choices for Deep Research: the DR endpoint's available
 * models, EXCLUDING reasoning models. Reasoning models (o-series, gpt-5.x) 400 on
 * DR's multi-turn tool loop, so they must never be selectable or savable as a DR
 * tool-node model — this is the single source of truth the admin UI and the write
 * validation both use.
 *
 * Scoped to `endpoint` when the tenant designates one (deepResearch.endpoint): a
 * model from another endpoint would 400 the run. Falls back to the union of all
 * endpoints when `endpoint` is unset OR names an endpoint with no models — a
 * mis-set endpoint must not brick the picker (the single-endpoint lab is unaffected
 * either way).
 */
function collectAvailableModels(
  modelsConfig: Record<string, string[]> | null | undefined,
  endpoint?: string,
): string[] {
  const scoped = endpoint ? modelsConfig?.[endpoint] : undefined;
  const sources =
    Array.isArray(scoped) && scoped.length > 0 ? [scoped] : Object.values(modelsConfig ?? {});
  const all = new Set<string>();
  for (const models of sources) {
    if (!Array.isArray(models)) {
      continue;
    }
    for (const model of models) {
      if (typeof model === 'string' && model && !isReasoningModel(model)) {
        all.add(model);
      }
    }
  }
  return [...all].sort();
}

/** Builds the settings payload: active tier, every tier's resolved config, available models. */
function buildSettings(
  appConfig: AppConfig,
  availableModels: string[],
): DeepResearchSettingsResponse {
  const drConfig = appConfig.deepResearch;
  const activeMode = (drConfig?.activeMode ?? 'deep') as DeepResearchMode;
  const modes = DeepResearchModes.map((name) =>
    resolveDeepResearchMode({ activeMode: name, modes: drConfig?.modes }),
  );
  return { activeMode, modes, availableModels };
}

/**
 * Admin handlers for the tenant-wide Deep Research settings.
 *
 * `activeMode` and per-mode `leadModel`/`workerModel` are written as overrides on
 * the base principal (apply to all users) via the config-override collection, then
 * config caches are invalidated so the next research run resolves the new values —
 * live, no redeploy. Model writes are validated against the endpoint's available
 * models so an unavailable slug can never be saved (it would 400 a research run).
 * Per-mode caps (budgets, cycles) remain seeded in `librechat.yaml`.
 */
export function createDeepResearchSettingsHandlers(deps: DeepResearchSettingsDeps): {
  getSettings: (req: ServerRequest, res: Response) => Promise<Response>;
  setActiveMode: (req: ServerRequest, res: Response) => Promise<Response>;
  setModeModels: (req: ServerRequest, res: Response) => Promise<Response>;
} {
  const { getAppConfig, getModelsConfig, patchConfigFields, invalidateConfigCaches } = deps;

  async function loadPayload(
    req: ServerRequest,
    refresh = false,
  ): Promise<DeepResearchSettingsResponse> {
    const tenantId = getTenantId(req);
    const [appConfig, modelsConfig] = await Promise.all([
      getAppConfig({ tenantId, refresh }),
      getModelsConfig(req),
    ]);
    return buildSettings(
      appConfig,
      collectAvailableModels(modelsConfig, appConfig.deepResearch?.endpoint),
    );
  }

  async function applyOverride(
    req: ServerRequest,
    fields: Record<string, unknown>,
  ): Promise<DeepResearchSettingsResponse> {
    await patchConfigFields(
      PrincipalType.ROLE,
      BASE_CONFIG_PRINCIPAL_ID,
      PrincipalModel.ROLE,
      fields,
      DEEP_RESEARCH_PRIORITY,
    );
    if (invalidateConfigCaches) {
      await invalidateConfigCaches(getTenantId(req));
    }
    return loadPayload(req, true);
  }

  async function getSettings(req: ServerRequest, res: Response): Promise<Response> {
    try {
      return res.status(200).json(await loadPayload(req));
    } catch (error) {
      logger.error('[adminDeepResearch] getSettings error:', error);
      return res.status(500).json({ error: 'Failed to load Deep Research settings' });
    }
  }

  async function setActiveMode(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const { activeMode } = (req.body ?? {}) as { activeMode?: string };
      if (!activeMode || !DeepResearchModes.includes(activeMode as DeepResearchMode)) {
        return res
          .status(400)
          .json({ error: `activeMode must be one of: ${DeepResearchModes.join(', ')}` });
      }
      return res.status(200).json(await applyOverride(req, { [ACTIVE_MODE_FIELD]: activeMode }));
    } catch (error) {
      logger.error('[adminDeepResearch] setActiveMode error:', error);
      return res.status(500).json({ error: 'Failed to update Deep Research mode' });
    }
  }

  async function setModeModels(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const { mode, leadModel, workerModel } = (req.body ?? {}) as {
        mode?: string;
        leadModel?: string;
        workerModel?: string;
      };
      if (!mode || !DeepResearchModes.includes(mode as DeepResearchMode)) {
        return res
          .status(400)
          .json({ error: `mode must be one of: ${DeepResearchModes.join(', ')}` });
      }
      /** Patch only the role(s) actually provided — never overwrite the sibling from
       *  a possibly-stale client value (avoids lost-update races on rapid edits). */
      const updates: Array<['leadModel' | 'workerModel', string]> = [];
      if (leadModel !== undefined) {
        updates.push(['leadModel', leadModel]);
      }
      if (workerModel !== undefined) {
        updates.push(['workerModel', workerModel]);
      }
      if (updates.length === 0) {
        return res.status(400).json({ error: 'Provide leadModel and/or workerModel' });
      }
      const [appConfig, modelsConfig] = await Promise.all([
        getAppConfig({ tenantId: getTenantId(req) }),
        getModelsConfig(req),
      ]);
      const available = collectAvailableModels(modelsConfig, appConfig.deepResearch?.endpoint);
      const invalid = updates
        .map(([, model]) => model)
        .filter((model) => !model || !available.includes(model));
      if (invalid.length) {
        return res.status(400).json({
          error: `Model(s) not usable for Deep Research (must be a non-reasoning model available on the endpoint): ${invalid.map((m) => m || '(empty)').join(', ')}`,
        });
      }
      const fields: Record<string, unknown> = {};
      for (const [role, model] of updates) {
        fields[`deepResearch.modes.${mode}.${role}`] = model;
      }
      return res.status(200).json(await applyOverride(req, fields));
    } catch (error) {
      logger.error('[adminDeepResearch] setModeModels error:', error);
      return res.status(500).json({ error: 'Failed to update Deep Research models' });
    }
  }

  return { getSettings, setActiveMode, setModeModels };
}
