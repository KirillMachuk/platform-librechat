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
    budgetGateRatio: 0.72,
    timeGateRatio: 0.68,
    digestCap: 6_000,
    compressInputChars: 165_000,
    toolResultWindow: 1,
  },
  deep: {
    name: 'deep',
    maxConcurrentResearchers: 4,
    maxOrchestratorCycles: 8,
    maxSearcherTurns: 5,
    perRunTokenBudget: 800_000,
    wallClockMinutes: 15,
    budgetGateRatio: 0.75,
    timeGateRatio: 0.7,
    digestCap: 8_000,
    compressInputChars: 205_000,
    toolResultWindow: 1,
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
 * Normalises a tier's `provider` override into the shape sent on the wire.
 *
 * Config arrives through zod but also through the admin override path, where a
 * half-written value (an empty `order`) is possible. An empty order would be sent as
 * `{"order": []}`, which OpenRouter reads as "no preference" while the config reads as
 * "pinned" — so a tier that looks pinned would silently route anywhere. Treat it as
 * unpinned instead, which is at least what it actually does.
 */
function normalizeProviderRouting(
  /** Deliberately looser than the resolved shape: config reaches here through
   *  `DeepPartial`, so `order` itself and every entry in it may be missing. */
  value: { order?: Array<string | undefined>; allow_fallbacks?: boolean } | undefined,
): ResolvedDeepResearchMode['provider'] | undefined {
  const order = value?.order?.filter(
    (entry): entry is string => typeof entry === 'string' && entry.trim() !== '',
  );
  if (!order?.length) {
    return undefined;
  }
  return {
    order,
    allow_fallbacks: value?.allow_fallbacks ?? true,
  };
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
    budgetGateRatio: override.budgetGateRatio ?? base.budgetGateRatio,
    timeGateRatio: override.timeGateRatio ?? base.timeGateRatio,
    digestCap: override.digestCap ?? base.digestCap,
    compressInputChars: override.compressInputChars ?? base.compressInputChars,
    toolResultWindow: override.toolResultWindow ?? base.toolResultWindow,
    leadModel: override.leadModel ?? base.leadModel,
    workerModel: override.workerModel ?? base.workerModel,
    writerModel: override.writerModel ?? base.writerModel,
    provider: normalizeProviderRouting(override.provider) ?? base.provider,
  };
}
