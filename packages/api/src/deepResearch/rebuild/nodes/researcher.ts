import { SystemMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import type { AIMessage, AIMessageChunk, BaseMessage, ToolCall } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type {
  DeepResearchFinding,
  DeepResearchTokenUsage,
  DeepResearchConfigurable,
} from '../state';
import type { DeepResearchTier } from '../config';
import type { DeepResearchNode } from '../graph';
import {
  extractText,
  mergeUsage,
  toErrorMessage,
  fenceUntrusted,
  usageFromExchange,
  sanitizeErrorForUser,
  stripCitationControlChars,
} from '../shared';
import { buildResearcherPrompt, buildCompressPrompt } from '../prompts';

const ZERO_USAGE: DeepResearchTokenUsage = { input: 0, output: 0, total: 0 };
/** Cap on raw tool text fed into COMPRESS — ≈8000 tokens at estimateTokens' ~3 chars/token. */
const COMPRESS_INPUT_CHAR_CAP = 24_000;
/** Per-tool-call raw output cap — bounds a single noisy page/result's context cost. */
const MAX_TOOL_OUTPUT_CHARS = 8_000;
/** Max tool calls executed per model turn — bounds fan-out width (M4). */
const MAX_TOOL_CALLS_PER_TURN = 5;
/** Per-tool-call wall-clock cap (ms) — a hung fetch/RAG query can't stall the run. */
const TOOL_TIMEOUT_MS = 60_000;
const MAX_SOURCES = 50;
const SOURCE_URL = /https?:\/\/[^\s)"'<>\]]+/g;

/** Minimal invoke surface satisfied by `model.bindTools(tools)` and test fakes. */
export interface ToolCaller {
  invoke(
    messages: BaseMessage[],
    options?: { signal?: AbortSignal },
  ): Promise<AIMessage | AIMessageChunk>;
}

export interface ResearcherNodeDeps {
  model: BaseChatModel;
  compressModel: BaseChatModel;
  tools: StructuredToolInterface[];
  tier: DeepResearchTier;
  /** Injected ISO timestamp (never `Date.now()` inside a graph node). */
  now: string;
  /** Per-run spotlighting nonce for fencing untrusted tool output (H5). */
  nonce: string;
}

export interface ResearchLoopResult {
  toolOutputs: string[];
  usage: DeepResearchTokenUsage;
}

async function executeToolCall(
  tool: StructuredToolInterface | undefined,
  call: ToolCall,
  signal?: AbortSignal,
): Promise<string> {
  if (!tool) {
    return `Инструмент "${call.name}" недоступен.`;
  }
  const cap = (text: string): string =>
    stripCitationControlChars(text).slice(0, MAX_TOOL_OUTPUT_CHARS);
  const timeout = AbortSignal.timeout(TOOL_TIMEOUT_MS);
  const toolSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const result: unknown = await tool.invoke(call, { signal: toolSignal });
    if (typeof result === 'string') {
      return cap(result);
    }
    if (result instanceof ToolMessage) {
      const content =
        typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
      return cap(content);
    }
    return cap(JSON.stringify(result));
  } catch (error) {
    if (signal?.aborted) {
      throw error; // external abort/timeout — propagate so the run finalizes a partial report
    }
    return `Ошибка инструмента ${call.name}: ${toErrorMessage(error)}`; // tool failure or per-call timeout
  }
}

/**
 * Runs the ReAct tool loop (model → tool calls → results → …) up to `maxTurns`.
 * A tool failure becomes error-string content, never a throw — so one bad tool
 * call cannot collapse the researcher. The loop also stops once its own token
 * spend reaches `tokenCap` (the run's remaining gather budget, M3) so a single
 * researcher cannot overrun between supervisor checks, and caps tool-call width
 * per turn (M4). Returns the raw tool outputs (for compress + source extraction)
 * and the model token usage.
 */
export async function runResearchLoop(params: {
  caller: ToolCaller;
  tools: StructuredToolInterface[];
  system: string;
  question: string;
  maxTurns: number;
  tokenCap: number;
  nonce: string;
  signal?: AbortSignal;
}): Promise<ResearchLoopResult> {
  const { caller, tools, system, question, maxTurns, tokenCap, nonce, signal } = params;
  const toolsByName = new Map(tools.map((t) => [t.name, t]));
  const messages: BaseMessage[] = [new SystemMessage(system), new HumanMessage(question)];
  const toolOutputs: string[] = [];
  let usage = ZERO_USAGE;

  for (let turn = 0; turn < Math.max(1, maxTurns); turn++) {
    const response = await caller.invoke(messages, { signal });
    usage = mergeUsage(usage, usageFromExchange(messages, response));
    messages.push(response);
    const toolCalls = response.tool_calls ?? [];
    if (toolCalls.length === 0 || usage.total >= tokenCap) {
      break;
    }
    for (let i = 0; i < toolCalls.length; i++) {
      const call = toolCalls[i];
      if (i >= MAX_TOOL_CALLS_PER_TURN) {
        // Every tool_call still needs a tool response (the provider rejects a
        // dangling tool_call_id), so skipped calls get a placeholder, not silence.
        const skipped = `Вызов инструмента "${call.name}" пропущен: лимит ${MAX_TOOL_CALLS_PER_TURN} вызовов за один ход.`;
        messages.push(
          new ToolMessage({ content: skipped, tool_call_id: call.id ?? '', name: call.name }),
        );
        continue;
      }
      const content = await executeToolCall(toolsByName.get(call.name), call, signal);
      toolOutputs.push(content);
      messages.push(
        new ToolMessage({
          content: fenceUntrusted(content, nonce),
          tool_call_id: call.id ?? '',
          name: call.name,
        }),
      );
    }
  }
  return { toolOutputs, usage };
}

/** Joins raw tool outputs into the single bounded block COMPRESS sees — also the
 *  exact text source URLs are pulled from, so citations match the compressed
 *  material rather than trailing material beyond the cap (L6). */
export function boundToolOutputs(toolOutputs: string[]): string {
  return toolOutputs.join('\n\n---\n\n').slice(0, COMPRESS_INPUT_CHAR_CAP);
}

/** Compresses the bounded gathered material into a digest. Empty input → empty digest. */
export async function compressResearch(params: {
  compressModel: BaseChatModel;
  subQuestion: string;
  jurisdiction: string;
  gathered: string;
  digestCap: number;
  now: string;
  nonce: string;
  signal?: AbortSignal;
}): Promise<{ digest: string; usage: Partial<DeepResearchTokenUsage> }> {
  const { compressModel, subQuestion, jurisdiction, gathered, digestCap, now, nonce, signal } =
    params;
  if (!gathered) {
    return { digest: '', usage: {} };
  }
  const prompt = [
    new SystemMessage(buildCompressPrompt({ subQuestion, jurisdiction, digestCap, now, nonce })),
    new HumanMessage(fenceUntrusted(gathered, nonce)),
  ];
  const response = await compressModel.invoke(prompt, { signal });
  return {
    digest: extractText(response).trim().slice(0, digestCap),
    usage: usageFromExchange(prompt, response),
  };
}

/** Unique source URLs from the bounded gathered material (for ГОСТ citations) —
 *  scanned over the SAME text COMPRESS saw, capped at MAX_SOURCES. */
export function extractSources(gathered: string): string[] {
  const urls = new Set<string>();
  const matches = gathered.match(SOURCE_URL);
  if (matches) {
    for (const match of matches) {
      urls.add(match.replace(/[.,;:]+$/, ''));
      if (urls.size >= MAX_SOURCES) {
        break;
      }
    }
  }
  return Array.from(urls);
}

/**
 * RESEARCHER — gathers material for one sub-question via a bounded tool loop,
 * then compresses it to a digest. Tools are pre-scoped by the caller (file_search
 * is built with chat-attached file_ids ONLY — the fix for bug ②). Never throws on
 * data/tool errors (records a placeholder finding + an error); re-throws only on
 * a real abort so the run wrapper can finalize a partial report.
 */
export function createResearcherNode(deps: ResearcherNodeDeps): DeepResearchNode {
  const { model } = deps;
  if (!model.bindTools) {
    throw new Error(
      '[deepResearch] researcher model does not support tool calling (bindTools missing)',
    );
  }
  const caller: ToolCaller = model.bindTools(deps.tools);

  return async function researcher(state, config) {
    const subQuestion = state.currentSubQuestion;
    const round = state.round;
    if (!subQuestion.trim()) {
      return {
        errors: [
          { node: 'researcher', message: 'dispatched without a sub-question', at: deps.now },
        ],
      };
    }

    const signal = config.signal;
    const budget = (config.configurable as DeepResearchConfigurable | undefined)?.budget;
    // Remaining gather budget for THIS researcher: the gather ceiling minus what the
    // run has already spent (NOT divided by researcher count — the graph is sequential,
    // so each dispatch sees the live remaining headroom). Unbudgeted runs get no cap.
    const tokenCap =
      budget && budget.tokenBudget > 0
        ? Math.max(0, budget.tokenBudget * budget.budgetGateRatio - state.tokenUsage.total)
        : Number.POSITIVE_INFINITY;
    try {
      const { toolOutputs, usage: loopUsage } = await runResearchLoop({
        caller,
        tools: deps.tools,
        system: buildResearcherPrompt({
          subQuestion,
          jurisdiction: state.jurisdiction,
          now: deps.now,
          maxTurns: deps.tier.maxSearcherTurns,
          nonce: deps.nonce,
        }),
        question: subQuestion,
        maxTurns: deps.tier.maxSearcherTurns,
        tokenCap,
        nonce: deps.nonce,
        signal,
      });
      const gathered = boundToolOutputs(toolOutputs);
      const { digest, usage: compressUsage } = await compressResearch({
        compressModel: deps.compressModel,
        subQuestion,
        jurisdiction: state.jurisdiction,
        gathered,
        digestCap: deps.tier.digestCap,
        now: deps.now,
        nonce: deps.nonce,
        signal,
      });
      const usage = mergeUsage(loopUsage, compressUsage);
      const finding: DeepResearchFinding = {
        round,
        subQuestion,
        digest: digest || '(по этому под-вопросу не удалось собрать данные)',
        sources: extractSources(gathered),
        tokens: usage.total,
      };
      return { findings: [finding], tokenUsage: usage };
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      return {
        findings: [
          {
            round,
            subQuestion,
            digest: `(ошибка исследования: ${sanitizeErrorForUser(error)})`,
            sources: [],
            tokens: 0,
          },
        ],
        errors: [{ node: 'researcher', message: toErrorMessage(error), at: deps.now }],
      };
    }
  };
}
