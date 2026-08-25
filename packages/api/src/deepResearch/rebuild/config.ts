import type { TDeepResearchConfig } from 'librechat-data-provider';
import type { ResolvedDeepResearchMode } from '../types';
import type { DeepResearchRunBudget } from './state';
import { resolveDeepResearchMode, resolveDeepResearchModel } from '../modes';

/**
 * A resolved tier for the StateGraph DR rebuild. `ResolvedDeepResearchMode` is the single
 * source of truth for models and limits (admin-overridable via `deepResearch.modes.<tier>`);
 * this adds only the derived COMPRESS model. Nothing about a tier is hardcoded here.
 */
export interface DeepResearchTier extends ResolvedDeepResearchMode {
  /** Model for the COMPRESS step; defaults to the worker model. */
  compressModel?: string;
}

/**
 * Resolves the active tier. Every budget/limit knob — including the gate ratios, the digest
 * cap, the COMPRESS input cap and the tool-result window — now comes from the mode resolver,
 * so an admin can tune them in config instead of waiting for an image rebuild. The only thing
 * this layer still adds is the COMPRESS model, which is derived rather than configured.
 */
export function resolveDeepResearchTier(config?: TDeepResearchConfig): DeepResearchTier {
  const base = resolveDeepResearchMode(config);
  return { ...base, compressModel: base.workerModel };
}

/** Derives the per-run budget carried on `config.configurable`. */
export function tierToRunBudget(tier: DeepResearchTier): DeepResearchRunBudget {
  return {
    wallClockMs: Math.max(1, tier.wallClockMinutes) * 60_000,
    tokenBudget: tier.perRunTokenBudget,
    budgetGateRatio: tier.budgetGateRatio,
    timeGateRatio: tier.timeGateRatio,
  };
}

/** Lead model — scope / supervisor / report (the stronger model per §4). */
export function leadModelFor(
  tier: DeepResearchTier,
  conversationModel?: string,
): string | undefined {
  return resolveDeepResearchModel(tier.leadModel, conversationModel);
}

/** Worker model — the researcher. Falls back to the lead model, never a reasoning chat model. */
export function workerModelFor(
  tier: DeepResearchTier,
  conversationModel?: string,
): string | undefined {
  return resolveDeepResearchModel(tier.workerModel, conversationModel, tier.leadModel);
}

/** Compress model — the digest step. Cheapest viable; defaults down the worker chain. */
export function compressModelFor(
  tier: DeepResearchTier,
  conversationModel?: string,
): string | undefined {
  return resolveDeepResearchModel(tier.compressModel, tier.workerModel, conversationModel);
}

/**
 * Report model — the tier's `writerModel` when set, else the lead model (§4: the strong model
 * is the quality lever).
 *
 * `writerModel` had been declared in the config schema, merged by the mode resolver, typed,
 * and returned by the admin API — and read by nothing at all. An admin who set it got a
 * platform that accepted the value, echoed it back, and kept writing reports on the lead.
 */
export function reportModelFor(
  tier: DeepResearchTier,
  conversationModel?: string,
): string | undefined {
  return resolveDeepResearchModel(tier.writerModel, leadModelFor(tier, conversationModel));
}
