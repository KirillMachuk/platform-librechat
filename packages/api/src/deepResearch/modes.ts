import type { TDeepResearchConfig, DeepResearchMode } from 'librechat-data-provider';
import type { ResolvedDeepResearchMode } from './types';

/**
 * Safe starting presets per depth tier. Admins override per mode via
 * `deepResearch.modes.<tier>` in config; the active tier is `deepResearch.activeMode`.
 * Deep keeps strong models (Opus lead / Sonnet worker via config); economy/balanced
 * move to cheaper models once the model price/quality benchmark lands.
 */
export const DEEP_RESEARCH_MODE_DEFAULTS: Record<DeepResearchMode, ResolvedDeepResearchMode> = {
  economy: {
    name: 'economy',
    maxConcurrentResearchers: 2,
    maxOrchestratorCycles: 4,
    maxSearcherTurns: 3,
    perRunTokenBudget: 200_000,
    wallClockMinutes: 5,
  },
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
 * OpenAI reasoning families (o-series and gpt-5.x, excluding the non-reasoning
 * `*-chat` instruct variants) require their reasoning trace to be replayed
 * between tool turns. LibreChat does not replay it, so these models return HTTP
 * 400 on Deep Research's multi-turn file_search / web_search loops. A DR tool
 * node (orchestrator or researcher) must never run on such a model.
 */
export function isReasoningModel(model?: string): boolean {
  if (!model) {
    return false;
  }
  const id = model.toLowerCase().split('/').pop() ?? '';
  if (id.includes('chat')) {
    return false;
  }
  return /^o[1-9]/.test(id) || /^gpt-5/.test(id);
}

/**
 * Picks the model for a Deep Research tool node. Forces the mode's configured
 * (non-thinking) model; when it is unset, skips any user-selected reasoning
 * model that would 400 on tool calls and prefers the first non-reasoning
 * fallback. Returns the first candidate only as a last resort (every candidate
 * is a reasoning model), so a misconfiguration degrades loudly rather than
 * silently inheriting the user's reasoning chat model.
 */
export function resolveDeepResearchModel(
  modeModel: string | undefined,
  ...fallbacks: Array<string | undefined>
): string | undefined {
  const candidates = [modeModel, ...fallbacks].filter((model): model is string => Boolean(model));
  return candidates.find((model) => !isReasoningModel(model)) ?? candidates[0];
}

/** Resolves the active Deep Research mode from tenant config, merged over defaults. */
export function resolveDeepResearchMode(config?: TDeepResearchConfig): ResolvedDeepResearchMode {
  const activeMode = (config?.activeMode ?? 'deep') as DeepResearchMode;
  const base = DEEP_RESEARCH_MODE_DEFAULTS[activeMode] ?? DEEP_RESEARCH_MODE_DEFAULTS.deep;
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
