import { SystemMessage, HumanMessage } from '@langchain/core/messages';

import type { RunnableConfig } from '@langchain/core/runnables';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { DeepResearchState, DeepResearchStateUpdate } from '../state';
import { lastHumanText, extractText, usageFromExchange, toErrorMessage, tolerantJsonParse } from '../shared';
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
  const candidate = String(value ?? '').toUpperCase().trim();
  return VALID_JURISDICTIONS.includes(candidate) ? (candidate as Jurisdiction) : 'UNSPECIFIED';
}

/** Parses SCOPE output; falls back to UNSPECIFIED + raw text as the brief. */
export function parseScopeOutput(text: string): { jurisdiction: Jurisdiction; brief: string } {
  const parsed = tolerantJsonParse(text);
  const jurisdiction = normalizeJurisdiction(parsed?.jurisdiction);
  const briefValue = parsed?.brief;
  const brief = typeof briefValue === 'string' && briefValue.trim() ? briefValue.trim() : text.trim();
  return { jurisdiction, brief };
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
      const prompt = [new SystemMessage(buildScopePrompt({ now: deps.now })), new HumanMessage(request)];
      const response = await deps.model.invoke(prompt, { signal: config?.signal });
      const { jurisdiction, brief } = parseScopeOutput(extractText(response));
      return {
        jurisdiction,
        researchBrief: brief,
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
