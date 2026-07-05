import { SystemMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { RunnableConfig } from '@langchain/core/runnables';
import type {
  DeepResearchState,
  DeepResearchStateUpdate,
  DeepResearchConfigurable,
} from '../state';
import type { DeepResearchTier } from '../config';
import {
  extractText,
  lastHumanText,
  toErrorMessage,
  tolerantJsonParse,
  usageFromExchange,
} from '../shared';
import { buildSupervisorPrompt } from '../prompts';

export interface SupervisorNodeDeps {
  model: BaseChatModel;
  tier: DeepResearchTier;
  /** Injected ISO timestamp (never `Date.now()` inside a graph node). */
  now: string;
  /** Per-run spotlighting nonce for fencing untrusted findings (H5). */
  nonce: string;
  /**
   * Injected wall-clock reader for the time gate (A1). Defaults to `Date.now`;
   * tests pass a fake so the gate is deterministic (the "never `Date.now()` in a
   * node" rule is why this is injected rather than called directly).
   */
  clock?: () => number;
}

/**
 * Deterministic gather-stop gate (the core of fix ③): returns a non-null reason
 * once the run has crossed its synthesis-reserve threshold of TIME (A1) or
 * tokens, or hit the round cap. The supervisor checks this BEFORE any model call,
 * so an exhausted run routes straight to REPORT — the model still writes the
 * report instead of the run being killed mid-flight and falling back. `now`/
 * `softDeadlineMs` unset → time arm off; `tokenBudget <= 0` → token arm off
 * (rounds always apply).
 */
export function budgetGateReason(args: {
  tokenUsed: number;
  round: number;
  tokenBudget: number;
  budgetGateRatio: number;
  maxRounds: number;
  now?: number;
  softDeadlineMs?: number;
}): 'budget' | 'rounds' | 'time' | null {
  if (args.softDeadlineMs != null && args.now != null && args.now >= args.softDeadlineMs) {
    return 'time';
  }
  if (args.tokenBudget > 0 && args.tokenUsed >= args.tokenBudget * args.budgetGateRatio) {
    return 'budget';
  }
  if (args.round >= args.maxRounds) {
    return 'rounds';
  }
  return null;
}

/** Collects the supervisor's next batch: the `subQuestions` array (preferred) else a
 *  single `subQuestion` (back-compat) — trimmed, de-duplicated, empties dropped, and
 *  capped at `maxBatch` so one round never dispatches more than the concurrency cap. */
export function normalizeSubQuestions(
  value: unknown,
  fallback: unknown,
  maxBatch: number,
): string[] {
  const raw = Array.isArray(value) ? value : [fallback];
  const seen = new Set<string>();
  const batch: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') {
      continue;
    }
    const question = item.trim();
    if (!question || seen.has(question)) {
      continue;
    }
    seen.add(question);
    batch.push(question);
    if (batch.length >= Math.max(1, maxBatch)) {
      break;
    }
  }
  return batch;
}

function parseSupervisorOutput(
  text: string,
  maxBatch: number,
): { completeRequested: boolean; subQuestions: string[] } {
  const parsed = tolerantJsonParse(text);
  const action = String(parsed?.action ?? '').toLowerCase();
  const subQuestions = normalizeSubQuestions(parsed?.subQuestions, parsed?.subQuestion, maxBatch);
  return { completeRequested: action.includes('complete'), subQuestions };
}

/**
 * SUPERVISOR — the gather-loop controller. The deterministic budget/round gate
 * runs first (no LLM when tripped); otherwise the model reflects on findings and
 * either picks the next sub-question (→ researcher) or concludes (→ report).
 * Never throws: a model failure concludes gracefully so REPORT still writes what
 * was gathered.
 */
export function createSupervisorNode(deps: SupervisorNodeDeps) {
  return async function supervisor(
    state: DeepResearchState,
    config: RunnableConfig,
  ): Promise<DeepResearchStateUpdate> {
    const configurable = config.configurable as DeepResearchConfigurable | undefined;
    const budget = configurable?.budget;
    const gate = budgetGateReason({
      tokenUsed: state.tokenUsage.total,
      round: state.round,
      tokenBudget: budget?.tokenBudget ?? 0,
      budgetGateRatio: budget?.budgetGateRatio ?? 1,
      maxRounds: deps.tier.maxOrchestratorCycles,
      now: (deps.clock ?? Date.now)(),
      softDeadlineMs: configurable?.softDeadlineMs,
    });
    if (gate) {
      return { concludeReason: gate };
    }

    try {
      const prompt = [
        new SystemMessage(
          buildSupervisorPrompt({
            now: deps.now,
            brief: state.researchBrief,
            jurisdiction: state.jurisdiction,
            findings: state.findings,
            round: state.round,
            maxRounds: deps.tier.maxOrchestratorCycles,
            maxConcurrent: deps.tier.maxConcurrentResearchers,
            nonce: deps.nonce,
          }),
        ),
      ];
      const response = await deps.model.invoke(prompt, { signal: config.signal });
      const { completeRequested, subQuestions } = parseSupervisorOutput(
        extractText(response),
        deps.tier.maxConcurrentResearchers,
      );
      const tokenUsage = usageFromExchange(prompt, response);
      // COMPLETE before ANY research ran (round 0) is always wrong — there is nothing
      // to report from. Malformed output (no valid batch, no explicit complete) must
      // not silently end the run either. Both degrade to researching the brief itself;
      // the deterministic gate above bounds how often this fallback can fire.
      if (completeRequested && state.round > 0) {
        return { concludeReason: 'complete', tokenUsage };
      }
      const fallbackQuestion = state.researchBrief.trim() || lastHumanText(state.messages);
      const batch = subQuestions.length > 0 ? subQuestions : [fallbackQuestion];
      return {
        currentSubQuestion: batch[0],
        currentSubQuestions: batch,
        round: state.round + 1,
        researcherCount: state.researcherCount + batch.length,
        tokenUsage,
      };
    } catch (error) {
      // A supervisor model failure is an ERROR partial (banner tells the user), never a
      // silent "completed" — that used to ship an empty report that looked successful.
      return {
        concludeReason: 'error',
        errors: [{ node: 'supervisor', message: toErrorMessage(error), at: deps.now }],
      };
    }
  };
}

/** Conditional edge: route to REPORT once SUPERVISOR concluded, else research. */
export function routeFromSupervisor(state: DeepResearchState): 'researcher' | 'report' {
  return state.concludeReason ? 'report' : 'researcher';
}
