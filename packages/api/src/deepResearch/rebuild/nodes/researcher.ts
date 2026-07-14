import { SystemMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import type { AIMessage, AIMessageChunk, BaseMessage, ToolCall } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type {
  DeepResearchFinding,
  DeepResearchNodeError,
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
/** Asset/media/font/style/script extensions — never article content (C1). */
const NON_CONTENT_EXT =
  /\.(?:jpe?g|png|gif|svg|webp|avif|ico|bmp|mp4|webm|mov|mp3|wav|css|js|mjs|woff2?|ttf|eot)(?:[?#]|$)/i;
/** Analytics/pixel/ad hosts and paths — noise, never a real source (C1). */
const TRACKER_URL =
  /(?:facebook\.com\/tr|google-analytics\.com|googletagmanager\.com|doubleclick\.net|mc\.yandex\.\w+\/(?:watch|pixel)|top-fwz1\.mail\.ru|vk\.com\/rtrg|\/pixel(?:[?/]|$))/i;
/** Redirect/interstitial hops that don't identify the real source (C1). */
const REDIRECT_URL =
  /(?:\/redirect(?:[?/]|$)|\/away(?:[?/]|$)|[?&]redirect=|l\.facebook\.com|out\.reddit\.com|\/goto\/)/i;

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
  /**
   * Injected wall-clock reader for the gather time gate (A1); defaults to `Date.now`.
   * Same contract as the supervisor's clock — a test passes a fake so the gate is
   * deterministic (hence injected rather than calling `Date.now()` in the node).
   */
  clock?: () => number;
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
  /** Gather deadline (ms) — stop STARTING new turns past it so REPORT keeps its reserved
   *  synthesis window. Reads the injected clock; unset (either) → time arm off (A1). */
  deadlineMs?: number;
  clock?: () => number;
}): Promise<ResearchLoopResult> {
  const { caller, tools, system, question, maxTurns, tokenCap, nonce, signal, deadlineMs, clock } =
    params;
  const toolsByName = new Map(tools.map((t) => [t.name, t]));
  const messages: BaseMessage[] = [new SystemMessage(system), new HumanMessage(question)];
  const toolOutputs: string[] = [];
  let usage = ZERO_USAGE;

  for (let turn = 0; turn < Math.max(1, maxTurns); turn++) {
    // Time gate (A1): once the gather deadline has passed, stop starting new turns so the
    // supervisor concludes and REPORT synthesises within its reserve — instead of a long
    // round blowing past the hard wall-clock and killing the run into a fallback dump.
    if (deadlineMs != null && clock != null && clock() >= deadlineMs) {
      break;
    }
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

/** True when a URL looks like real article/page content — not an image/asset, an
 *  analytics/ad tracker, or a redirect hop (C1 source hygiene). PDFs are kept (they
 *  are often the actual document/report). */
export function isContentUrl(url: string): boolean {
  return !NON_CONTENT_EXT.test(url) && !TRACKER_URL.test(url) && !REDIRECT_URL.test(url);
}

/** Unique CONTENT source URLs from the bounded gathered material (for ГОСТ citations)
 *  — scanned over the SAME text COMPRESS saw, asset/tracker/redirect noise dropped
 *  (C1), capped at MAX_SOURCES. */
export function extractSources(gathered: string): string[] {
  const urls = new Set<string>();
  const matches = gathered.match(SOURCE_URL);
  if (matches) {
    for (const match of matches) {
      const url = match.replace(/[.,;:]+$/, '');
      if (!isContentUrl(url)) {
        continue;
      }
      urls.add(url);
      if (urls.size >= MAX_SOURCES) {
        break;
      }
    }
  }
  return Array.from(urls);
}

/** Digest placeholder when the tool loop yielded nothing to compress. */
export const EMPTY_DIGEST = '(по этому под-вопросу не удалось собрать данные)';

/** Digest prefix when the research of a sub-question failed outright. */
export const FAILED_DIGEST_PREFIX = '(ошибка исследования';

/** True when a finding carries REAL gathered material (not an empty/failure placeholder).
 *  REPORT uses this to refuse writing a fake "completed" note out of placeholders. */
export function hasResearchMaterial(finding: DeepResearchFinding): boolean {
  const digest = finding.digest.trim();
  return digest.length > 0 && digest !== EMPTY_DIGEST && !digest.startsWith(FAILED_DIGEST_PREFIX);
}

export interface ResearchOneResult {
  finding: DeepResearchFinding;
  usage: DeepResearchTokenUsage;
  /** Set on a non-fatal data/tool failure (recorded on the errors channel); abort re-throws. */
  error?: DeepResearchNodeError;
}

/**
 * Researches ONE sub-question end-to-end: bounded tool loop → compress → source
 * extraction. Never throws on data/tool errors (returns an error-finding so a
 * sibling in the same parallel batch can't collapse it); re-throws only on a real
 * abort so the batch can propagate it and the run wrapper finalizes a partial.
 */
export async function researchOne(params: {
  caller: ToolCaller;
  deps: ResearcherNodeDeps;
  subQuestion: string;
  round: number;
  jurisdiction: string;
  tokenCap: number;
  signal?: AbortSignal;
  deadlineMs?: number;
}): Promise<ResearchOneResult> {
  const { caller, deps, subQuestion, round, jurisdiction, tokenCap, signal, deadlineMs } = params;
  try {
    const { toolOutputs, usage: loopUsage } = await runResearchLoop({
      caller,
      tools: deps.tools,
      system: buildResearcherPrompt({
        subQuestion,
        jurisdiction,
        now: deps.now,
        maxTurns: deps.tier.maxSearcherTurns,
        nonce: deps.nonce,
      }),
      question: subQuestion,
      maxTurns: deps.tier.maxSearcherTurns,
      tokenCap,
      nonce: deps.nonce,
      signal,
      deadlineMs,
      // Default to Date.now like the supervisor's gate — production wires no clock, so
      // without this the time arm would silently never fire (tests pass a fake).
      clock: deps.clock ?? Date.now,
    });
    const gathered = boundToolOutputs(toolOutputs);
    const { digest, usage: compressUsage } = await compressResearch({
      compressModel: deps.compressModel,
      subQuestion,
      jurisdiction,
      gathered,
      digestCap: deps.tier.digestCap,
      now: deps.now,
      nonce: deps.nonce,
      signal,
    });
    const usage = mergeUsage(loopUsage, compressUsage);
    return {
      finding: {
        round,
        subQuestion,
        digest: digest || EMPTY_DIGEST,
        sources: extractSources(gathered),
        tokens: usage.total,
      },
      usage,
    };
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }
    return {
      finding: {
        round,
        subQuestion,
        digest: `${FAILED_DIGEST_PREFIX}: ${sanitizeErrorForUser(error)})`,
        sources: [],
        tokens: 0,
      },
      usage: ZERO_USAGE,
      error: { node: 'researcher', message: toErrorMessage(error), at: deps.now },
    };
  }
}

/**
 * RESEARCHER — dispatches the supervisor's batch of sub-questions and researches
 * them IN PARALLEL (A2), each via `researchOne`. The run's remaining gather budget
 * is split across the batch so concurrent researchers can't collectively overspend.
 * Tools are pre-scoped by the caller (file_search = chat-attached file_ids ONLY —
 * the fix for bug ②). Never throws on data/tool errors; re-throws only on abort.
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
    const round = state.round;
    const batch = (
      state.currentSubQuestions.length ? state.currentSubQuestions : [state.currentSubQuestion]
    )
      .map((question) => question?.trim())
      .filter((question): question is string => Boolean(question));
    if (batch.length === 0) {
      return {
        errors: [
          { node: 'researcher', message: 'dispatched without a sub-question', at: deps.now },
        ],
      };
    }

    const signal = config.signal;
    const configurable = config.configurable as DeepResearchConfigurable | undefined;
    const budget = configurable?.budget;
    // Same gather deadline the supervisor gate concludes on (A1) — each researcher stops
    // starting new turns past it so the round can't overrun into REPORT's reserve.
    const deadlineMs = configurable?.softDeadlineMs;
    // Remaining gather headroom, SPLIT across the batch: the researchers run concurrently
    // and cannot see each other's spend, so each gets an equal slice to keep the batch
    // within the run's budget. Unbudgeted runs get no cap.
    const remaining =
      budget && budget.tokenBudget > 0
        ? Math.max(0, budget.tokenBudget * budget.budgetGateRatio - state.tokenUsage.total)
        : Number.POSITIVE_INFINITY;
    const perResearcherCap = Number.isFinite(remaining) ? remaining / batch.length : remaining;

    // allSettled (not Promise.all): a real abort in one researcher must not orphan its
    // siblings' rejections into unhandled rejections; settle all, then propagate abort once.
    const settled = await Promise.allSettled(
      batch.map((subQuestion) =>
        researchOne({
          caller,
          deps,
          subQuestion,
          round,
          jurisdiction: state.jurisdiction,
          tokenCap: perResearcherCap,
          signal,
          deadlineMs,
        }),
      ),
    );
    const aborted = settled.find(
      (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
    );
    if (aborted) {
      throw aborted.reason; // researchOne rejects ONLY on a real abort — surface it to the run wrapper
    }

    const results = settled
      .filter((o): o is PromiseFulfilledResult<ResearchOneResult> => o.status === 'fulfilled')
      .map((o) => o.value);
    const findings = results.map((r) => r.finding);
    const usage = results.reduce((acc, r) => mergeUsage(acc, r.usage), ZERO_USAGE);
    const errors = results
      .map((r) => r.error)
      .filter((error): error is DeepResearchNodeError => Boolean(error));
    return errors.length > 0
      ? { findings, tokenUsage: usage, errors }
      : { findings, tokenUsage: usage };
  };
}
