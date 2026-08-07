import { logger, BASE_CONFIG_PRINCIPAL_ID } from '@librechat/data-schemas';
import { PrincipalType, PrincipalModel, AutoModes } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { AutoMode } from 'librechat-data-provider';
import type { Types, ClientSession } from 'mongoose';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import { resolveAutoMode } from '~/agents/auto';

/**
 * Admin control for the "Auto" orchestrator's mode.
 *
 * The switch is tenant-wide and takes effect on the next message: the value is written as
 * a config override and the caches are dropped, so nothing is redeployed and nobody is
 * disconnected. Which models and prompts each mode carries stays in `librechat.yaml` —
 * those are validated by a benchmark, so they are not something to retype into a form.
 */

const AUTO_PRIORITY = 10;
const ACTIVE_MODE_FIELD = 'auto.activeMode';

export interface AutoModeSummary {
  name: AutoMode;
  model: string;
  researcherId: string;
  /** False when the mode is missing a model or a researcher — it will not be used. */
  configured: boolean;
}

export interface AutoSettingsResponse {
  activeMode: AutoMode;
  /** Every mode the config declares, so the admin sees what a switch would select. */
  modes: AutoModeSummary[];
  /** False when no Auto config exists at all; the card then runs as written in the file. */
  enabled: boolean;
}

export interface AutoSettingsDeps {
  getAppConfig: (options?: { tenantId?: string; refresh?: boolean }) => Promise<AppConfig>;
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

function getTenantId(req: ServerRequest): string | undefined {
  return (req.user as { tenantId?: string } | undefined)?.tenantId;
}

function buildSettings(appConfig: AppConfig): AutoSettingsResponse {
  const auto = appConfig.auto;
  const modes: AutoModeSummary[] = AutoModes.map((name) => {
    const mode = auto?.modes?.[name];
    return {
      name,
      model: mode?.model ?? '',
      researcherId: mode?.researcherId ?? '',
      configured: Boolean(mode?.model && mode.researcherId),
    };
  });
  return {
    /** Report what would ACTUALLY run, not the stored string: an unconfigured active mode
     *  falls back to the cheap one, and an admin must see the same answer the chat gets. */
    activeMode: resolveAutoMode(auto)?.name ?? (auto?.activeMode as AutoMode) ?? AutoModes[0],
    modes,
    enabled: Boolean(auto?.modes),
  };
}

export function createAutoSettingsHandlers(deps: AutoSettingsDeps): {
  getSettings: (req: ServerRequest, res: Response) => Promise<Response>;
  setActiveMode: (req: ServerRequest, res: Response) => Promise<Response>;
} {
  const { getAppConfig, patchConfigFields, invalidateConfigCaches } = deps;

  async function load(req: ServerRequest, refresh = false): Promise<AutoSettingsResponse> {
    return buildSettings(await getAppConfig({ tenantId: getTenantId(req), refresh }));
  }

  async function getSettings(req: ServerRequest, res: Response): Promise<Response> {
    try {
      return res.status(200).json(await load(req));
    } catch (error) {
      logger.error('[adminAuto] getSettings error:', error);
      return res.status(500).json({ error: 'Failed to load Auto settings' });
    }
  }

  async function setActiveMode(req: ServerRequest, res: Response): Promise<Response> {
    try {
      const { activeMode } = (req.body ?? {}) as { activeMode?: string };
      if (!activeMode || !AutoModes.includes(activeMode as AutoMode)) {
        return res
          .status(400)
          .json({ error: `activeMode must be one of: ${AutoModes.join(', ')}` });
      }

      const current = await load(req);
      const target = current.modes.find((mode) => mode.name === activeMode);
      /** Refuse a switch that would silently do nothing. A mode with no researcher stops
       *  delegating without any visible symptom, so it must not be selectable at all. */
      if (!target?.configured) {
        return res.status(400).json({
          error: `Режим «${activeMode}» не настроен: нужны и model, и researcherId в librechat.yaml`,
        });
      }

      await patchConfigFields(
        PrincipalType.ROLE,
        BASE_CONFIG_PRINCIPAL_ID,
        PrincipalModel.ROLE,
        { [ACTIVE_MODE_FIELD]: activeMode },
        AUTO_PRIORITY,
      );
      if (invalidateConfigCaches) {
        await invalidateConfigCaches(getTenantId(req));
      }
      logger.info(`[adminAuto] режим «Авто» переключён на ${activeMode}`);
      return res.status(200).json(await load(req, true));
    } catch (error) {
      logger.error('[adminAuto] setActiveMode error:', error);
      return res.status(500).json({ error: 'Failed to update Auto mode' });
    }
  }

  return { getSettings, setActiveMode };
}
