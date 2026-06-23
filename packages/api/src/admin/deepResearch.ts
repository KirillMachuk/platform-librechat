import { logger, BASE_CONFIG_PRINCIPAL_ID } from '@librechat/data-schemas';
import { PrincipalType, PrincipalModel, DeepResearchModes } from 'librechat-data-provider';
import type { DeepResearchMode } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { Types, ClientSession } from 'mongoose';
import type { Response } from 'express';
import type { ResolvedDeepResearchMode } from '../deepResearch';
import type { ServerRequest } from '~/types/http';
import { resolveDeepResearchMode } from '../deepResearch';

/** Priority of the tenant-wide Deep Research override; matches the admin config default. */
const DEEP_RESEARCH_PRIORITY = 10;

/** Dot-path of the activeMode field within the config override document. */
const ACTIVE_MODE_FIELD = 'deepResearch.activeMode';

export interface DeepResearchSettingsResponse {
  activeMode: DeepResearchMode;
  /** Resolved caps + models for every depth tier (for display in the admin UI). */
  modes: ResolvedDeepResearchMode[];
}

export interface DeepResearchSettingsDeps {
  /** Returns the merged AppConfig (YAML base + DB overrides) for the tenant. */
  getAppConfig: (options?: { tenantId?: string; refresh?: boolean }) => Promise<AppConfig>;
  /** Patches individual config fields by dot-path on a principal's override document. */
  patchConfigFields: (
    principalType: PrincipalType,
    principalId: string | Types.ObjectId,
    principalModel: PrincipalModel,
    fields: Record<string, unknown>,
    priority: number,
    session?: ClientSession,
  ) => Promise<unknown>;
  /** Invalidate config caches so the new mode applies to subsequent requests. */
  invalidateConfigCaches?: (tenantId?: string) => Promise<void>;
}

function getTenantId(req: ServerRequest): string | undefined {
  return (req.user as { tenantId?: string } | undefined)?.tenantId;
}

/** Builds the settings payload: the active tier plus every tier's resolved config. */
function buildSettings(appConfig: AppConfig): DeepResearchSettingsResponse {
  const drConfig = appConfig.deepResearch;
  const activeMode = (drConfig?.activeMode ?? 'deep') as DeepResearchMode;
  const modes = DeepResearchModes.map((name) =>
    resolveDeepResearchMode({ activeMode: name, modes: drConfig?.modes }),
  );
  return { activeMode, modes };
}

/**
 * Admin handlers for the tenant-wide Deep Research depth setting.
 *
 * Switching the active mode writes a single `deepResearch.activeMode` override on
 * the base principal (applies to all users) via the existing config-override
 * collection, then invalidates config caches so the next research run resolves
 * the new tier. Per-mode model/budget definitions stay in `librechat.yaml`.
 */
export function createDeepResearchSettingsHandlers(deps: DeepResearchSettingsDeps): {
  getSettings: (req: ServerRequest, res: Response) => Promise<Response>;
  setActiveMode: (req: ServerRequest, res: Response) => Promise<Response>;
} {
  const { getAppConfig, patchConfigFields, invalidateConfigCaches } = deps;

  async function getSettings(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const appConfig = await getAppConfig({ tenantId: getTenantId(req) });
      return res.status(200).json(buildSettings(appConfig));
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

      const tenantId = getTenantId(req);
      await patchConfigFields(
        PrincipalType.ROLE,
        BASE_CONFIG_PRINCIPAL_ID,
        PrincipalModel.ROLE,
        { [ACTIVE_MODE_FIELD]: activeMode },
        DEEP_RESEARCH_PRIORITY,
      );

      if (invalidateConfigCaches) {
        await invalidateConfigCaches(tenantId);
      }

      const appConfig = await getAppConfig({ tenantId, refresh: true });
      return res.status(200).json(buildSettings(appConfig));
    } catch (error) {
      logger.error('[adminDeepResearch] setActiveMode error:', error);
      return res.status(500).json({ error: 'Failed to update Deep Research mode' });
    }
  }

  return { getSettings, setActiveMode };
}
