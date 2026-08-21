import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { DeepResearchState, DeepResearchStateUpdate } from '../state';
import {
  lastHumanText,
  readAnswer,
  usageFromExchange,
  toErrorMessage,
  tolerantJsonParse,
} from '../shared';
import { buildScopePrompt } from '../prompts';

/** Target jurisdiction. UNSPECIFIED when not stated — never silently RU. */
export type Jurisdiction = 'RU' | 'RB' | 'KZ' | 'UNSPECIFIED';

const VALID_JURISDICTIONS: readonly string[] = ['RU', 'RB', 'KZ'];

export interface ScopeNodeDeps {
  model: BaseChatModel;
  /** Injected ISO timestamp (never `Date.now()` inside a graph node). */
  now: string;
}

function normalizeJurisdiction(value: unknown): Jurisdiction {
  const candidate = String(value ?? '')
    .toUpperCase()
    .trim();
  return VALID_JURISDICTIONS.includes(candidate) ? (candidate as Jurisdiction) : 'UNSPECIFIED';
}

/**
 * Parses SCOPE output; falls back to UNSPECIFIED + raw text as the brief.
 *
 * `fromJson` reports WHICH of the two produced `brief`. The caller needs that to tell a model
 * that answered in prose (whose raw text is a perfectly usable brief) from one that was cut
 * off mid-JSON (whose raw text is a fragment).
 */
export function parseScopeOutput(text: string): {
  jurisdiction: Jurisdiction;
  brief: string;
  fromJson: boolean;
} {
  const parsed = tolerantJsonParse(text);
  const jurisdiction = normalizeJurisdiction(parsed?.jurisdiction);
  const briefValue = parsed?.brief;
  const fromJson = typeof briefValue === 'string' && briefValue.trim().length > 0;
  const brief = fromJson ? (briefValue as string).trim() : text.trim();
  return { jurisdiction, brief, fromJson };
}

/**
 * SCOPE — the first node. Determines the target jurisdiction (RU/RB/KZ, never
 * defaulted to RU) and a research brief from the user's request. Never throws:
 * on model failure it degrades to UNSPECIFIED + the raw request as the brief.
 */
export function createScopeNode(deps: ScopeNodeDeps) {
  return async function scope(
    state: DeepResearchState,
    config?: RunnableConfig,
  ): Promise<DeepResearchStateUpdate> {
    const request = lastHumanText(state.messages);
    try {
      const prompt = [
        new SystemMessage(buildScopePrompt({ now: deps.now })),
        new HumanMessage(request),
      ];
      const response = await deps.model.invoke(prompt, { signal: config?.signal });
      const answer = readAnswer('scope', response);
      const { jurisdiction, brief, fromJson } = parseScopeOutput(answer.text);
      /**
       * A CUT answer is a JSON FRAGMENT, not a brief. `parseScopeOutput` falls back to the raw
       * text, and for a truncated answer the raw text is `{"jurisdiction":"RU","brief":"…` —
       * which then became the brief every later node reasoned over, with the jurisdiction lost
       * as well, since a fragment does not parse. The EMPTY case was already handled below;
       * truncation reached the same damage by a different road.
       *
       * The condition is "cut AND not parsed", so it also catches CUT PROSE — an answer that
       * was never JSON and stopped mid-sentence. That is deliberate: a half-sentence is not a
       * better brief than the user's own question. Prose that is merely not JSON and came back
       * WHOLE still becomes the brief, which is the case worth keeping.
       */
      const cutFragment = answer.truncated && !fromJson;
      return {
        jurisdiction,
        /**
         * An empty answer used to yield an EMPTY brief — `parseScopeOutput` falls back to
         * the raw text, and the raw text was nothing. Every later node then reasoned over
         * a blank brief. The user's own request is always a usable brief; blankness never is.
         */
        researchBrief: cutFragment ? request : brief || request,
        tokenUsage: usageFromExchange(prompt, response),
      };
    } catch (error) {
      return {
        jurisdiction: 'UNSPECIFIED',
        researchBrief: request,
        errors: [{ node: 'scope', message: toErrorMessage(error), at: deps.now }],
      };
    }
  };
}
