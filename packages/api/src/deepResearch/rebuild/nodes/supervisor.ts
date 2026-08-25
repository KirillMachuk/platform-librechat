import { logger } from '@librechat/data-schemas';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { RunnableConfig } from '@langchain/core/runnables';
import type {
  DeepResearchState,
  DeepResearchStateUpdate,
  DeepResearchConfigurable,
} from '../state';
import type { DeepResearchTier } from '../config';
import {
  lastHumanText,
  readAnswer,
  toErrorMessage,
  tolerantJsonParse,
  usageFromExchange,
  usageByModelFromExchange,
  configuredModelName,
} from '../shared';
import { buildSupervisorInput, buildSupervisorPrompt } from '../prompts';

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
 *
 * The time arm asks "would ANOTHER round finish before the reserve?", not "are we
 * past the reserve?" — a round already dispatched cannot be interrupted, so the
 * point-in-time check leaked: on the stand a round was dispatched 3 SECONDS before
 * the reserve, ran 4 minutes, and the hard watchdog killed the run with no report at
 * all (findings=3, 27% of the token budget spent, twelve minutes of the user's time
 * for nothing). Raising the wall clock does not fix that — it moves the same leak
 * later, because the check never knew what a round costs.
 *
 * The estimate is the mean round duration OF THIS RUN — `(now - runStartedMs) / round`,
 * where `round` counts COMPLETED rounds — so it needs no new state channel and adapts
 * to a slow topic or a slow model instead of a guessed constant. Before the first round
 * there is nothing to measure: the estimate is 0 and the first round always runs, which
 * is also what keeps a short wall clock from refusing to research at all. The remaining
 * reserve absorbs a round that overruns the mean; a round that overruns it grossly is
 * the hard watchdog's business, not this gate's.
 *
 * `runStartedMs` unset → estimate 0 → byte-identical to the old point check.
 */
export function budgetGateReason(args: {
  tokenUsed: number;
  round: number;
  tokenBudget: number;
  budgetGateRatio: number;
  maxRounds: number;
  now?: number;
  softDeadlineMs?: number;
  runStartedMs?: number;
}): 'budget' | 'rounds' | 'time' | null {
  if (args.softDeadlineMs != null && args.now != null) {
    const nextRoundMs =
      args.runStartedMs != null && args.round > 0
        ? Math.max(0, args.now - args.runStartedMs) / args.round
        : 0;
    if (args.now + nextRoundMs >= args.softDeadlineMs) {
      return 'time';
    }
  }
  if (args.tokenBudget > 0) {
    /**
     * The token arm asks the same question as the time arm above — "would ANOTHER round fit
     * inside the reserve?" — and for the same reason. A round cannot be interrupted, so a
     * point-in-time check ("are we past the reserve yet?") dispatches rounds it cannot pay
     * for: on the stand the supervisor would dispatch on ANY remaining headroom, and a round
     * sent at 287 900 of a 288 000 gate gave each of three researchers ~33 tokens. Each of
     * them then refused to start (the researcher's own turn-0 gate) and the round produced
     * nothing while still counting as a round.
     *
     * The estimate is the mean round cost OF THIS RUN — `tokenUsed / round`, where `round`
     * counts COMPLETED rounds — so it needs no constant and adapts to a topic that reads
     * long. Before the first round there is nothing to measure: the estimate is 0 and the
     * first round always runs, which is what keeps a small budget researching a little
     * rather than refusing outright. Counting the run's fixed overhead (scope, plan) into
     * the mean makes the estimate slightly high, which errs towards the reserve.
     */
    const nextRoundTokens = args.round > 0 ? args.tokenUsed / args.round : 0;
    if (args.tokenUsed + nextRoundTokens >= args.tokenBudget * args.budgetGateRatio) {
      return 'budget';
    }
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
      runStartedMs: configurable?.runStartedMs,
    });
    if (gate) {
      return { concludeReason: gate };
    }

    try {
      // System = rules, Human = the material to decide on — the shape every other node in
      // this graph already uses. A system-only call left the model with nothing to answer
      // and it returned EMPTY on 7 of 28 measured calls; an empty answer parses to no
      // sub-questions and the fallback below researches the whole brief as ONE question,
      // silently costing the round its parallel fan-out.
      const prompt = [
        new SystemMessage(
          buildSupervisorPrompt({
            now: deps.now,
            jurisdiction: state.jurisdiction,
            maxConcurrent: deps.tier.maxConcurrentResearchers,
            nonce: deps.nonce,
          }),
        ),
        new HumanMessage(
          buildSupervisorInput({
            brief: state.researchBrief,
            findings: state.findings,
            round: state.round,
            maxRounds: deps.tier.maxOrchestratorCycles,
            nonce: deps.nonce,
          }),
        ),
      ];
      const response = await deps.model.invoke(prompt, { signal: config.signal });
      const answer = readAnswer('supervisor', response);
      const { completeRequested, subQuestions } = parseSupervisorOutput(
        answer.text,
        deps.tier.maxConcurrentResearchers,
      );
      const tokenUsage = usageFromExchange(prompt, response);
      const usageByModel = usageByModelFromExchange(
        prompt,
        response,
        configuredModelName(deps.model),
      );
      // COMPLETE before ANY research ran (round 0) is always wrong — there is nothing
      // to report from. Malformed output (no valid batch, no explicit complete) must
      // not silently end the run either. Both degrade to researching the brief itself;
      // the deterministic gate above bounds how often this fallback can fire.
      if (completeRequested && state.round > 0) {
        return { concludeReason: 'complete', tokenUsage, usageByModel };
      }
      /**
       * Everything past this point takes the one-question fallback, and it used to take it in
       * silence.
       *
       * `readAnswer` reports EMPTY and CUT answers. A third degradation looks perfectly
       * healthy to it: a full, non-empty answer that simply is not the JSON this node asked
       * for — prose, an apology, an unclosed code fence. It parses to no batch, so the round
       * researches the whole brief as ONE question and loses its parallel fan-out. Same cost
       * as the empty answer fixed before it, and the same invisibility — which is what made
       * that one cost a live investigation. A 'complete' on round 0 lands here too, and is
       * just as wrong, so it belongs in the same line rather than a second one.
       */
      if (subQuestions.length === 0 && !answer.empty) {
        logger.warn(
          `[deepResearch:supervisor] unparseable answer (${answer.text.length} chars): ` +
            'no usable sub-questions — falling back to the brief as ONE question, ' +
            "losing this round's fan-out",
        );
      }
      const fallbackQuestion = state.researchBrief.trim() || lastHumanText(state.messages);
      const batch = subQuestions.length > 0 ? subQuestions : [fallbackQuestion];
      return {
        currentSubQuestion: batch[0],
        currentSubQuestions: batch,
        round: state.round + 1,
        researcherCount: state.researcherCount + batch.length,
        tokenUsage,
        usageByModel,
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
