import { isReasoningModel } from 'librechat-data-provider';
import type { TDeepResearchConfig, DeepResearchMode } from 'librechat-data-provider';
import type { ResolvedDeepResearchMode } from './types';

/**
 * Safe starting presets per depth tier. Admins override per mode via
 * `deepResearch.modes.<tier>` in config; the active tier is `deepResearch.activeMode`.
 * Deep keeps strong models (Opus lead / Sonnet worker via config); balanced runs the
 * cheap model the price/quality benchmark picked.
 */
export const DEEP_RESEARCH_MODE_DEFAULTS: Record<DeepResearchMode, ResolvedDeepResearchMode> = {
  balanced: {
    name: 'balanced',
    maxConcurrentResearchers: 3,
    maxOrchestratorCycles: 6,
    maxSearcherTurns: 4,
    perRunTokenBudget: 400_000,
    wallClockMinutes: 8,
  },
  deep: {
    name: 'deep',
    maxConcurrentResearchers: 4,
    maxOrchestratorCycles: 8,
    maxSearcherTurns: 5,
    perRunTokenBudget: 800_000,
    wallClockMinutes: 15,
  },
};

/**
 * Re-exported from `librechat-data-provider` (single source of truth, shared
 * with the agent-save and agent-initialization tool gates). Kept exported here
 * so existing Deep Research imports keep resolving from this module.
 */
export { isReasoningModel };

/**
 * Picks the model for a Deep Research tool node. Forces the mode's configured
 * (non-thinking) model; when it is unset, skips any user-selected reasoning
 * model that would 400 on tool calls and prefers the first non-reasoning
 * fallback. Returns `undefined` when EVERY candidate is a reasoning model — a
 * misconfiguration the caller must reject with a clear error rather than send a
 * reasoning model into DR's multi-turn tool loop (which 400s opaquely). Never
 * returns a reasoning model.
 */
export function resolveDeepResearchModel(
  modeModel: string | undefined,
  ...fallbacks: Array<string | undefined>
): string | undefined {
  const candidates = [modeModel, ...fallbacks].filter((model): model is string => Boolean(model));
  return candidates.find((model) => !isReasoningModel(model));
}

/**
 * Resolves the active Deep Research mode from tenant config, merged over defaults.
 *
 * An unknown tier falls back to `balanced`, not `deep`: the retired `economy` value can
 * still sit in a tenant's stored override, and resolving it to the premium tier would
 * silently bill Opus-priced research to a tenant who had chosen the cheapest option.
 */
export function resolveDeepResearchMode(config?: TDeepResearchConfig): ResolvedDeepResearchMode {
  const activeMode = (config?.activeMode ?? 'deep') as DeepResearchMode;
  const base = DEEP_RESEARCH_MODE_DEFAULTS[activeMode] ?? DEEP_RESEARCH_MODE_DEFAULTS.balanced;
  const override = config?.modes?.[activeMode];
  if (!override) {
    return { ...base };
  }
  return {
    name: base.name,
    maxConcurrentResearchers: override.maxConcurrentResearchers ?? base.maxConcurrentResearchers,
    maxOrchestratorCycles: override.maxOrchestratorCycles ?? base.maxOrchestratorCycles,
    maxSearcherTurns: override.maxSearcherTurns ?? base.maxSearcherTurns,
    perRunTokenBudget: override.perRunTokenBudget ?? base.perRunTokenBudget,
    wallClockMinutes: override.wallClockMinutes ?? base.wallClockMinutes,
    leadModel: override.leadModel ?? base.leadModel,
    workerModel: override.workerModel ?? base.workerModel,
    writerModel: override.writerModel ?? base.writerModel,
  };
}
