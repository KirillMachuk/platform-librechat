import { AutoModes } from 'librechat-data-provider';
import type { AutoMode, TModelSpec } from 'librechat-data-provider';

/**
 * The "Auto" orchestrator in two modes, switched tenant-wide by an admin.
 *
 * Both modes are the same spec with the same tools; what an admin changes is the brain,
 * its prompt, and which researcher it delegates to. Resolution happens per request rather
 * than by rewriting config, so the switch takes effect on the next message with no deploy
 * and no restart — the same shape Deep Research depth tiers already use.
 *
 * A mode is applied ONLY to its own spec. Everything else on the endpoint — a model the
 * user picked by hand, another spec — passes through untouched.
 */

/**
 * Config as it actually arrives: every field optional. The YAML schema fills defaults, but
 * an admin override is patched in by dot-path and bypasses them, so completeness is checked
 * here rather than assumed. A mode missing its model or its researcher is treated as absent
 * — half a mode would disable delegation with no visible symptom.
 */
export interface AutoConfigInput {
  spec?: string;
  activeMode?: AutoMode;
  modes?: Partial<
    Record<AutoMode, { model?: string; researcherId?: string; instructions?: string } | undefined>
  >;
}

export interface ResolvedAutoMode {
  name: AutoMode;
  model: string;
  researcherId: string;
  instructions?: string;
}

/** Whether this spec is the one the Auto config governs. */
export function isAutoSpec(
  config: AutoConfigInput | undefined,
  specName: string | undefined,
): boolean {
  if (!config?.modes || !specName) {
    return false;
  }
  return (config.spec ?? 'auto') === specName;
}

/**
 * The active mode, or undefined when Auto is not configured or the active mode has no
 * entry. Undefined means "change nothing": the spec keeps the model and prompt written in
 * the config file, which is a working orchestrator rather than a broken one.
 */
export function resolveAutoMode(config: AutoConfigInput | undefined): ResolvedAutoMode | undefined {
  if (!config?.modes) {
    return undefined;
  }
  const complete = (candidate: AutoMode): ResolvedAutoMode | undefined => {
    const mode = config.modes?.[candidate];
    if (!mode?.model || !mode.researcherId) {
      return undefined;
    }
    return {
      name: candidate,
      model: mode.model,
      researcherId: mode.researcherId,
      instructions: mode.instructions,
    };
  };
  const requested = (config.activeMode ?? AutoModes[0]) as AutoMode;
  return complete(requested) ?? complete(AutoModes[0]);
}

export interface AutoOverrides {
  model: string;
  instructions?: string;
  subagents: NonNullable<TModelSpec['subagents']>;
}

/**
 * What the active mode changes about the spec. Returns undefined when nothing should
 * change, so a caller can skip the override entirely rather than reassigning identical
 * values. `allowSelf` is forced off: a spawn-yourself target carries the ORCHESTRATOR's
 * prompt instead of the researcher's, and the model can pick the wrong one.
 */
export function autoOverridesFor(
  config: AutoConfigInput | undefined,
  specName: string | undefined,
): AutoOverrides | undefined {
  if (!isAutoSpec(config, specName)) {
    return undefined;
  }
  const mode = resolveAutoMode(config);
  if (!mode) {
    return undefined;
  }
  return {
    model: mode.model,
    ...(mode.instructions ? { instructions: mode.instructions } : {}),
    subagents: { enabled: true, allowSelf: false, agent_ids: [mode.researcherId] },
  };
}
