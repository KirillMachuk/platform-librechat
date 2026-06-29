import { resolveDeepResearchMode, resolveDeepResearchModel } from '../modes';

import type { TDeepResearchConfig, DeepResearchMode } from 'librechat-data-provider';
import type { ResolvedDeepResearchMode } from '../types';
import type { DeepResearchRunBudget } from './state';

/**
 * A resolved tier for the StateGraph DR rebuild. Extends the existing
 * `ResolvedDeepResearchMode` (single source of truth for models + limits,
 * admin-overridable via `deepResearch.modes.<tier>`) with the extra knobs the
 * new graph needs. Model slugs and budgets are NEVER hardcoded here — they come
 * from `resolveDeepResearchMode`; only the new graph-specific defaults live here.
 */
export interface DeepResearchTier extends ResolvedDeepResearchMode {
  /** Model for the COMPRESS step; defaults to the worker model. */
  compressModel?: string;
  /**
   * Fraction of `perRunTokenBudget` at which SUPERVISOR stops dispatching and
   * routes to REPORT, reserving the remainder for synthesis (§4).
   */
  budgetGateRatio: number;
  /** Max characters of one researcher digest — bounds outer-state growth (§4). */
  digestCap: number;
}

/**
 * New graph-specific per-tier defaults (not yet admin-exposed; promoted to
 * config in Phase 3 tuning). Budgets/models stay in the existing config.
 */
const TIER_EXTRAS: Record<DeepResearchMode, { budgetGateRatio: number; digestCap: number }> = {
  economy: { budgetGateRatio: 0.7, digestCap: 800 },
  balanced: { budgetGateRatio: 0.72, digestCap: 1200 },
  deep: { budgetGateRatio: 0.75, digestCap: 2000 },
};

/** Resolves the active tier (models/limits from config) plus the new graph knobs. */
export function resolveDeepResearchTier(config?: TDeepResearchConfig): DeepResearchTier {
  const base = resolveDeepResearchMode(config);
  const extras = TIER_EXTRAS[base.name] ?? TIER_EXTRAS.deep;
  return {
    ...base,
    compressModel: base.workerModel,
    budgetGateRatio: extras.budgetGateRatio,
    digestCap: extras.digestCap,
  };
}

/** Derives the per-run budget carried on `config.configurable`. */
export function tierToRunBudget(tier: DeepResearchTier): DeepResearchRunBudget {
  return {
    wallClockMs: Math.max(1, tier.wallClockMinutes) * 60_000,
    tokenBudget: tier.perRunTokenBudget,
    budgetGateRatio: tier.budgetGateRatio,
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

/** Report model — synthesis runs on the lead model (§4: strong model is the quality lever). */
export function reportModelFor(
  tier: DeepResearchTier,
  conversationModel?: string,
): string | undefined {
  return leadModelFor(tier, conversationModel);
}
