import { SystemMessage } from '@langchain/core/messages';

import type { RunnableConfig } from '@langchain/core/runnables';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type {
  DeepResearchState,
  DeepResearchStateUpdate,
  DeepResearchConfigurable,
} from '../state';
import type { DeepResearchTier } from '../config';
import { extractText, usageFromExchange, toErrorMessage, tolerantJsonParse } from '../shared';
import { buildSupervisorPrompt } from '../prompts';

export interface SupervisorNodeDeps {
  model: BaseChatModel;
  tier: DeepResearchTier;
  /** Injected ISO timestamp (never `Date.now()` inside a graph node). */
  now: string;
  /** Per-run spotlighting nonce for fencing untrusted findings (H5). */
  nonce: string;
}

/**
 * Deterministic gather-stop gate (the core of fix ③): returns a non-null reason
 * once the run has spent its synthesis-reserve threshold of budget, or hit the
 * round cap. The supervisor checks this BEFORE any model call, so an exhausted
 * run routes straight to REPORT instead of burning more tokens or being killed
 * mid-flight. `tokenBudget <= 0` disables the token arm (rounds still apply).
 */
export function budgetGateReason(args: {
  tokenUsed: number;
  round: number;
  tokenBudget: number;
  budgetGateRatio: number;
  maxRounds: number;
}): 'budget' | 'rounds' | null {
  if (args.tokenBudget > 0 && args.tokenUsed >= args.tokenBudget * args.budgetGateRatio) {
    return 'budget';
  }
  if (args.round >= args.maxRounds) {
    return 'rounds';
  }
  return null;
}

function parseSupervisorOutput(text: string): { complete: boolean; subQuestion: string } {
  const parsed = tolerantJsonParse(text);
  const action = String(parsed?.action ?? '').toLowerCase();
  const subQuestionValue = parsed?.subQuestion;
  const subQuestion = typeof subQuestionValue === 'string' ? subQuestionValue.trim() : '';
  return { complete: action.includes('complete') || !subQuestion, subQuestion };
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
            nonce: deps.nonce,
          }),
        ),
      ];
      const response = await deps.model.invoke(prompt, { signal: config.signal });
      const { complete, subQuestion } = parseSupervisorOutput(extractText(response));
      if (complete) {
        return {
          concludeReason: 'complete',
          tokenUsage: usageFromExchange(prompt, response),
        };
      }
      return {
        currentSubQuestion: subQuestion,
        round: state.round + 1,
        researcherCount: state.researcherCount + 1,
        tokenUsage: usageFromExchange(prompt, response),
      };
    } catch (error) {
      return {
        concludeReason: 'complete',
        errors: [{ node: 'supervisor', message: toErrorMessage(error), at: deps.now }],
      };
    }
  };
}

/** Conditional edge: route to REPORT once SUPERVISOR concluded, else research. */
export function routeFromSupervisor(state: DeepResearchState): 'researcher' | 'report' {
  return state.concludeReason ? 'report' : 'researcher';
}
