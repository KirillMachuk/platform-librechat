import { logger } from '@librechat/data-schemas';
import { SystemMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import type { AIMessage, AIMessageChunk, BaseMessage, ToolCall } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type {
  DeepResearchFinding,
  DeepResearchNodeError,
  DeepResearchTokenUsage,
  DeepResearchUsageByModel,
  DeepResearchConfigurable,
} from '../state';
import type { DeepResearchTier } from '../config';
import type { DeepResearchNode } from '../graph';
import {
  readAnswer,
  extractText,
  estimateTokens,
  mergeUsage,
  toErrorMessage,
  fenceUntrusted,
  usageFromExchange,
  usageByModelFromExchange,
  mergeUsageByModel,
  configuredModelName,
  sanitizeErrorForUser,
  estimateTokensOfLength,
  estimateContextTokens,
  stripCitationControlChars,
} from '../shared';
import { buildResearcherPrompt, buildCompressPrompt } from '../prompts';

const ZERO_USAGE: DeepResearchTokenUsage = { input: 0, output: 0, total: 0 };
/**
 * Fallback cap on raw tool text fed into COMPRESS, used only when a caller passes none.
 * The real cap is `tier.compressInputChars` — this constant is what the cap USED to be, and
 * it was the tightest point of the whole pipeline: a researcher gathers up to
 * `maxSearcherTurns x MAX_TOOL_CALLS_PER_TURN x MAX_TOOL_OUTPUT_CHARS` characters (160 000
 * on the balanced tier), and `.slice` keeps the FIRST 24 000 of them. Turn one alone
 * overflows that, so turns two and up were researched, paid for, re-sent in every later
 * prompt — and then dropped before they could reach the digest, let alone the report.
 */
const COMPRESS_INPUT_CHAR_CAP = 24_000;
/**
 * Replaces a tool result that has fallen out of the researcher's context window. The
 * `tool_call` record itself stays, so the model still knows the call happened and what it
 * asked for; only the payload goes. Kept short on purpose — it is re-sent every turn.
 */
const CLEARED_TOOL_RESULT =
  '[результат убран из переписки — он уже сохранён в собранном материале]';
/** Per-tool-call raw output cap — bounds a single noisy page/result's context cost.
 *  Exported: with `MAX_TOOL_CALLS_PER_TURN` it is the arithmetic a tier's `compressInputChars`
 *  has to clear, and a guard asserts the shipped tiers do. */
export const MAX_TOOL_OUTPUT_CHARS = 8_000;
/** Max tool calls executed per model turn — bounds fan-out width (M4). */
export const MAX_TOOL_CALLS_PER_TURN = 5;
/** What `boundToolOutputs` joins tool outputs with; counted by `maxGatheredChars`. */
const TOOL_OUTPUT_SEPARATOR = '\n\n---\n\n';
/** Per-tool-call wall-clock cap (ms) — a hung fetch/RAG query can't stall the run. */
const TOOL_TIMEOUT_MS = 60_000;
/** Floor for the deadline-shortened timeout, so a call starting marginally late still sends. */
const MIN_TOOL_TIMEOUT_MS = 5_000;
/** Cap on source URLs extracted per finding. Exported: REPORT starts its first synthesis
 *  attempt at exactly this width, so the two must not drift apart silently. */
export const MAX_SOURCES = 50;
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
  /**
   * The loop's tokens by ANSWERING model. Kept separate from COMPRESS's own figure rather
   * than merged at the node boundary: the tool loop runs on the worker model and COMPRESS
   * on `compressModel`, which the tier happens to set to the same slug today. Merging here
   * would make a future split of those two silently mis-attribute.
   */
  usageByModel: DeepResearchUsageByModel;
}

/**
 * One tool call's outcome. `ok: false` marks text the model must still SEE — it has to know
 * the search failed so it can try another angle — but which is NOT research material.
 *
 * The distinction was missing, and it cost the run its honesty. A failure string went into
 * `toolOutputs` beside real results, COMPRESS summarised it into a digest, and
 * `hasResearchMaterial` — which only recognises the two placeholder digests — let it through.
 * So a dead search key did not produce the "could not gather material" notice this filter
 * exists for: it produced a confident report, with a comparison table, marked 'completed',
 * with a PDF, whose entire evidence base was the sentence "Ошибка инструмента web_search: …".
 */
interface ToolCallOutcome {
  /** What the model sees as this call's result — real data, or the failure text. */
  text: string;
  /** True only when the tool actually returned data. */
  ok: boolean;
}

/**
 * Per-call timeout, never longer than the time left before the gather deadline.
 *
 * The turn gate below refuses to START a turn past the deadline, but a turn already started
 * runs to its end: up to `MAX_TOOL_CALLS_PER_TURN` sequential calls of `TOOL_TIMEOUT_MS`
 * each — 300 s past a synthesis reserve that is 270 s on the deep tier. That is the same
 * point-in-time leak the supervisor's gate had (see `budgetGateReason`), one level down, and
 * it ends the same way: the hard watchdog kills the run and the user gets no report at all.
 *
 * Bounding the CALLS is preferred over predicting the turn's length: while more than
 * `TOOL_TIMEOUT_MS` still remains — the whole run bar its last minute — every call keeps its
 * full timeout, where a predictive gate would already have been refusing whole turns. Inside
 * that last minute calls ARE shortened, and one that would have run past the deadline is cut
 * short; that is the intended trade, since the alternative is the watchdog killing the run
 * outright. The floor keeps a call that starts marginally late from being aborted before it
 * can even send.
 */
export function toolTimeoutMs(budgetMs?: number): number {
  if (budgetMs == null || !Number.isFinite(budgetMs)) {
    return TOOL_TIMEOUT_MS;
  }
  return Math.max(MIN_TOOL_TIMEOUT_MS, Math.min(TOOL_TIMEOUT_MS, budgetMs));
}

async function executeToolCall(
  tool: StructuredToolInterface | undefined,
  call: ToolCall,
  signal?: AbortSignal,
  /** Wall-clock left before the gather deadline (ms); unset → full `TOOL_TIMEOUT_MS`. */
  budgetMs?: number,
): Promise<ToolCallOutcome> {
  if (!tool) {
    return { text: `Инструмент "${call.name}" недоступен.`, ok: false };
  }
  const cap = (text: string): string =>
    stripCitationControlChars(text).slice(0, MAX_TOOL_OUTPUT_CHARS);
  const timeout = AbortSignal.timeout(toolTimeoutMs(budgetMs));
  const toolSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const result: unknown = await tool.invoke(call, { signal: toolSignal });
    if (typeof result === 'string') {
      return { text: cap(result), ok: true };
    }
    if (result instanceof ToolMessage) {
      const content =
        typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
      return { text: cap(content), ok: true };
    }
    return { text: cap(JSON.stringify(result)), ok: true };
  } catch (error) {
    if (signal?.aborted) {
      throw error; // external abort/timeout — propagate so the run finalizes a partial report
    }
    // tool failure or per-call timeout — the model sees it, the digest must not
    return {
      text: `Ошибка инструмента ${call.name}: ${toErrorMessage(error)}`,
      ok: false,
    };
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
 *
 * `toolResultWindow` bounds how much of that history is re-sent. Without it every turn
 * pays again for every page the previous turns read, which is where roughly half of a
 * round's tokens went: measured on the stand, a researcher's prompt tokens outweighed its
 * completion tokens nine to one. Results outside the window are replaced by
 * `CLEARED_TOOL_RESULT`. Nothing is lost to the report by this — `toolOutputs` is a
 * SEPARATE accumulator and COMPRESS reads it, not the message history.
 */
export async function runResearchLoop(params: {
  caller: ToolCaller;
  tools: StructuredToolInterface[];
  system: string;
  question: string;
  maxTurns: number;
  tokenCap: number;
  nonce: string;
  /** How many recent turns keep their RAW tool results in context; 0 or unset → keep all. */
  toolResultWindow?: number;
  signal?: AbortSignal;
  /** Gather deadline (ms) — stop STARTING new turns past it so REPORT keeps its reserved
   *  synthesis window. Reads the injected clock; unset (either) → time arm off (A1). */
  deadlineMs?: number;
  clock?: () => number;
  /**
   * Slug of the model behind `caller`, for exchanges where the provider does not name
   * itself. It has to be passed in: `caller` is what `bindTools()` returned — a
   * RunnableBinding wrapping the model, which carries none of the model's own fields, so
   * reading the name off it yields 'unknown' for every worker turn.
   */
  callerModel?: string;
}): Promise<ResearchLoopResult> {
  const { caller, tools, system, question, maxTurns, tokenCap, nonce, signal, deadlineMs, clock } =
    params;
  const toolsByName = new Map(tools.map((t) => [t.name, t]));
  const messages: BaseMessage[] = [new SystemMessage(system), new HumanMessage(question)];
  const toolOutputs: string[] = [];
  /** Indices into `messages` of each turn's tool results, oldest turn first. */
  const toolMessageTurns: number[][] = [];
  const window = Math.max(0, params.toolResultWindow ?? 0);
  let usage = ZERO_USAGE;
  /** Output tokens of the last exchange — the only part of the next turn's cost that is not
   *  already visible in `messages`. */
  let lastOutputTokens = 0;
  /** Tool results replaced by the window, for the log line at the end of the loop. */
  let clearedResults = 0;
  let usageByModel: DeepResearchUsageByModel = {};
  const callerModel = params.callerModel ?? configuredModelName(caller);

  for (let turn = 0; turn < Math.max(1, maxTurns); turn++) {
    // Time gate (A1): once the gather deadline has passed, stop starting new turns so the
    // supervisor concludes and REPORT synthesises within its reserve — instead of a long
    // round blowing past the hard wall-clock and killing the run into a fallback dump.
    if (deadlineMs != null && clock != null && clock() >= deadlineMs) {
      break;
    }
    /**
     * Budget gate: a turn the cap cannot pay for is never STARTED.
     *
     * The cap used to be checked only AFTER the model call. A researcher already at its cap
     * therefore still made the call, was billed for it, and had every tool call it asked for
     * thrown away — the turn bought literally nothing. Measured on the stand 24.08: it fired
     * 7 times across 9 runs, i.e. most runs paid for at least one dead turn.
     *
     * The waste is not only the call. `perResearcherCap` is the run's REMAINING gather budget
     * divided by the batch, so tokens burned on a turn that produces no material are taken
     * from the researchers of every later round as well.
     *
     * Turn 0 has no previous turn, and the first version of this gate therefore let it run
     * unconditionally. Two independent reviews measured what that costs: with the budget
     * already spent, `perResearcherCap` is 0 (or a handful of tokens — the supervisor
     * dispatches a round on ANY remaining headroom, so a round sent at 287 900 of a 288 000
     * gate gives each of three researchers ~33), and the researcher then paid for a model
     * call whose tool calls the backstop immediately discarded. The very waste this gate was
     * written to stop, moved from turn N to turn 0, three times per round.
     *
     * So turn 0 runs unless the cap cannot cover even the prompt about to be SENT. That is
     * arithmetic, not a guess: a call whose input alone exceeds the cap cannot come back
     * inside it. Anything above that floor still runs — a small cap must research a little,
     * not refuse.
     */
    if (turn === 0 && Number.isFinite(tokenCap) && estimateTokens(system + question) >= tokenCap) {
      logger.info(
        `[deepResearch:researcher] not starting: cap ${Math.round(tokenCap)} cannot cover the ` +
          `opening prompt (~${estimateTokens(system + question)}), the call would be billed for nothing`,
      );
      break;
    }
    /**
     * What the next turn costs is its PROMPT plus its answer, and the prompt is sitting
     * right here in `messages` — so measure it rather than infer it from the last turn's
     * total. That inference was systematically low: the tool results of turn N are not in
     * turn N's prompt but ARE in turn N+1's, and a sweep across cap values found 20 of 44
     * still ending in a turn that was billed and had its tool calls discarded. The answer
     * is the one part not yet observable; the last answer stands in for it, floored by its
     * own text so a provider-reported total that disagrees with the estimate cannot drive
     * it below zero.
     */
    const turnPrompt = estimateContextTokens(messages);
    const nextTurnEstimate = turnPrompt + lastOutputTokens;
    if (turn > 0 && usage.total + nextTurnEstimate >= tokenCap) {
      logger.info(
        `[deepResearch:researcher] not starting turn ${turn + 1}: spent ${Math.round(usage.total)}, ` +
          `next turn ~${Math.round(nextTurnEstimate)} (context ${Math.round(turnPrompt)} + ` +
          `answer ~${Math.round(lastOutputTokens)}), cap ${Math.round(tokenCap)}`,
      );
      break;
    }
    const spentBeforeTurn = usage.total;
    const response = await caller.invoke(messages, { signal });
    usage = mergeUsage(usage, usageFromExchange(messages, response));
    lastOutputTokens = Math.max(
      estimateTokens(extractText(response)),
      usage.total - spentBeforeTurn - turnPrompt,
    );
    usageByModel = mergeUsageByModel(
      usageByModel,
      usageByModelFromExchange(messages, response, callerModel),
    );
    messages.push(response);
    const toolCalls = response.tool_calls ?? [];
    // A researcher that answers nothing AND asks for no tool simply stops below, keeping
    // whatever it had — often nothing. Worth a line: it is indistinguishable in the logs
    // from a researcher that finished its work.
    if (toolCalls.length === 0) {
      readAnswer('researcher', response);
      break;
    }
    if (usage.total >= tokenCap) {
      /**
       * Backstop. The gate above should now prevent this from being reached, because a turn
       * that cannot be paid for is not started — but the estimate can be wrong (a turn whose
       * tool output is far larger than the last one's), and when it is, this still stops the
       * loop rather than overrunning. If this line appears in the logs it means the estimate
       * missed, which is worth knowing: the turn was billed and its tool calls discarded.
       */
      logger.warn(
        `[deepResearch:researcher] token cap reached (${usage.total}/${Math.round(tokenCap)}) with ` +
          `${toolCalls.length} tool call(s) unexecuted — this turn produced no material`,
      );
      break;
    }
    const turnToolMessages: number[] = [];
    for (let i = 0; i < toolCalls.length; i++) {
      const call = toolCalls[i];
      if (i >= MAX_TOOL_CALLS_PER_TURN) {
        // Every tool_call still needs a tool response (the provider rejects a
        // dangling tool_call_id), so skipped calls get a placeholder, not silence.
        const skipped = `Вызов инструмента "${call.name}" пропущен: лимит ${MAX_TOOL_CALLS_PER_TURN} вызовов за один ход.`;
        turnToolMessages.push(messages.length);
        // Fenced like every other tool message: `call.name` is written by a model that has
        // just read untrusted pages, so this string is model-derived text and must not sit
        // outside the fence its siblings sit inside.
        messages.push(
          new ToolMessage({
            content: fenceUntrusted(skipped, nonce),
            tool_call_id: call.id ?? '',
            name: call.name,
          }),
        );
        continue;
      }
      const outcome = await executeToolCall(
        toolsByName.get(call.name),
        call,
        signal,
        deadlineMs != null && clock != null ? Math.max(0, deadlineMs - clock()) : undefined,
      );
      // Only real data becomes research material. A failure is still shown to the model (it
      // must know, to try another angle) and logged — but it is never compressed into a
      // digest that then reads like evidence.
      if (outcome.ok) {
        toolOutputs.push(outcome.text);
      } else {
        // The failure TEXT is deliberately not logged: on the legacy (non-sovereign) path it
        // can echo the user's raw query back, and this runner takes care elsewhere never to
        // put research content in the logs.
        // The NAME is printed from the tool registry, not from `call.name`: the latter is
        // produced by a model that has just read untrusted web pages, so echoing it into the
        // log is a (narrow) path for page content to reach a place this runner keeps clean.
        // An unknown name is the interesting case anyway — it means the model invented one.
        const loggedName = toolsByName.has(call.name) ? call.name : 'unknown';
        logger.warn(
          `[deepResearch:researcher] tool "${loggedName}" returned no data ` +
            `(${outcome.text.length} chars of failure text, not logged)`,
        );
      }
      const content = fenceUntrusted(outcome.text, nonce);
      turnToolMessages.push(messages.length);
      messages.push(new ToolMessage({ content, tool_call_id: call.id ?? '', name: call.name }));
    }
    toolMessageTurns.push(turnToolMessages);
    clearedResults += clearStaleToolResults(messages, toolMessageTurns, window);
  }
  // The window is the whole point of the change and is otherwise invisible: without this
  // line the stand cannot answer "did clearing run, and how much did it take out?".
  if (window > 0) {
    // A window at least as wide as the turn cap can never clear anything, and "0 cleared"
    // reads as "there was nothing to clear" rather than "this knob is doing nothing".
    const inert =
      window >= Math.max(1, maxTurns) ? ' (window >= maxSearcherTurns: never fires)' : '';
    logger.info(
      `[deepResearch:researcher] tool-result window ${window}${inert}: ${clearedResults} result(s) ` +
        `cleared from the prompt, ${toolOutputs.length} kept for the digest`,
    );
  }
  return { toolOutputs, usage, usageByModel };
}

/**
 * Replaces the payload of every tool result older than `window` turns with a short marker,
 * in place, and returns how many were replaced. `window <= 0` disables clearing — byte-
 * identical to the behaviour before this existed. Only turns strictly OUTSIDE the window are
 * touched, so the model always sees the results it just asked for.
 *
 * The marker replaces the CONTENT, never the message: a provider rejects a `tool_call` with
 * no matching `tool_result`, so dropping the message outright would break the exchange.
 */
export function clearStaleToolResults(
  messages: BaseMessage[],
  toolMessageTurns: number[][],
  window: number,
): number {
  if (window <= 0 || toolMessageTurns.length <= window) {
    return 0;
  }
  let cleared = 0;
  for (const indices of toolMessageTurns.slice(0, toolMessageTurns.length - window)) {
    for (const index of indices) {
      const message = messages[index];
      if (!(message instanceof ToolMessage) || message.content === CLEARED_TOOL_RESULT) {
        continue;
      }
      messages[index] = new ToolMessage({
        content: CLEARED_TOOL_RESULT,
        tool_call_id: message.tool_call_id,
        name: message.name,
      });
      cleared += 1;
    }
  }
  return cleared;
}

/** Joins raw tool outputs into the single bounded block COMPRESS sees — also the
 *  exact text source URLs are pulled from, so citations match the compressed
 *  material rather than trailing material beyond the cap (L6). */
/**
 * The most characters ONE researcher can hand COMPRESS on a tier: every turn's tool calls at
 * their per-call cap, plus the separators `boundToolOutputs` puts between them. A tier whose
 * `compressInputChars` sits below this pays for material and then drops it — which is what
 * the old fixed 24 000 did to every turn after the first.
 */
export function maxGatheredChars(maxSearcherTurns: number): number {
  const calls = Math.max(1, maxSearcherTurns) * MAX_TOOL_CALLS_PER_TURN;
  return calls * MAX_TOOL_OUTPUT_CHARS + (calls - 1) * TOOL_OUTPUT_SEPARATOR.length;
}

export function boundToolOutputs(toolOutputs: string[], cap: number): string {
  /**
   * Empty outputs are dropped BEFORE the join: `['', '']` joined to `'\n\n---\n\n'` — a
   * TRUTHY string — so `compressResearch`'s "empty input → empty digest" shortcut never
   * fired and the compress model was invoked, and billed, on nothing but separators.
   */
  const kept = toolOutputs.filter((output) => output.trim().length > 0);
  const bounded = kept.join(TOOL_OUTPUT_SEPARATOR).slice(0, Math.max(1, cap));
  const gathered =
    kept.reduce((total, output) => total + output.length, 0) +
    Math.max(0, kept.length - 1) * TOOL_OUTPUT_SEPARATOR.length;
  if (gathered > bounded.length) {
    // Dropping material that was already searched for, fetched and paid for is the defect
    // this cap exists around, not a routine event. It is silent by nature — the digest that
    // follows looks exactly the same — so it says so out loud, in numbers, never content.
    logger.warn(
      `[deepResearch:researcher] COMPRESS cap dropped ${gathered - bounded.length} of ` +
        `${gathered} gathered chars (cap ${cap}); raise compressInputChars or lower ` +
        'maxSearcherTurns — this material was paid for and will not reach the report',
    );
  }
  return bounded;
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
}): Promise<{
  digest: string;
  usage: Partial<DeepResearchTokenUsage>;
  usageByModel: DeepResearchUsageByModel;
}> {
  const { compressModel, subQuestion, jurisdiction, gathered, digestCap, now, nonce, signal } =
    params;
  if (!gathered) {
    return { digest: '', usage: {}, usageByModel: {} };
  }
  const prompt = [
    new SystemMessage(buildCompressPrompt({ subQuestion, jurisdiction, digestCap, now, nonce })),
    new HumanMessage(fenceUntrusted(gathered, nonce)),
  ];
  const response = await compressModel.invoke(prompt, { signal });
  /**
   * An empty digest still becomes a FINDING: it counts towards `findings.length`, reaches
   * REPORT, and contributes nothing — which is how a run can report N findings and read
   * like one. Nothing is decided here (a caller filtering findings would change the run's
   * shape); the degradation is simply no longer silent.
   */
  const answer = readAnswer('compress', response);
  return {
    digest: answer.text.slice(0, digestCap),
    usage: usageFromExchange(prompt, response),
    usageByModel: usageByModelFromExchange(prompt, response, configuredModelName(compressModel)),
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
  // `match` would materialise EVERY url in the block before the cap is applied, and the block
  // is now the researcher's whole gathering rather than its first 24 000 characters. Walking
  // the regex stops at the cap instead.
  const scanner = new RegExp(SOURCE_URL.source, 'g');
  for (let hit = scanner.exec(gathered); hit !== null; hit = scanner.exec(gathered)) {
    const url = hit[0].replace(/[.,;:]+$/, '');
    if (!isContentUrl(url)) {
      continue;
    }
    urls.add(url);
    if (urls.size >= MAX_SOURCES) {
      break;
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

/**
 * COMPRESS is the biggest single call a researcher makes, and it used to sit outside
 * every budget: `tokenCap` was handed to the tool loop only, and the compress call that
 * follows was made unconditionally. That was tolerable while its input was capped at
 * 24 000 characters (~8k tokens); at a tier's real gathering it is ~53k on balanced and
 * ~67k on deep — more than the loop itself — so the unbudgeted half had become the
 * larger half. An admin raising `maxSearcherTurns` to 6 could put a round 11% over the
 * whole run's budget with nothing to stop it: the new engine has no hard token abort,
 * only the wall-clock watchdog.
 *
 * So the loop is given what is left AFTER reserving what compress will cost. The reserve
 * is the worst case (the cap, or the tier's own gathering ceiling if that is smaller),
 * and it is never more than half the researcher's budget — a reserve that starves the
 * loop would spend the round's money and have nothing to compress.
 */
export function researcherBudgetSplit(
  tier: Pick<DeepResearchTier, 'compressInputChars' | 'maxSearcherTurns'>,
  tokenCap: number,
): { loopCap: number; compressChars: number } {
  const compressChars = Math.min(tier.compressInputChars, maxGatheredChars(tier.maxSearcherTurns));
  if (!Number.isFinite(tokenCap)) {
    return { loopCap: tokenCap, compressChars };
  }
  const compressReserve = Math.min(estimateTokensOfLength(compressChars), tokenCap / 2);
  return { loopCap: Math.max(0, tokenCap - compressReserve), compressChars };
}

export interface ResearchOneResult {
  finding: DeepResearchFinding;
  usage: DeepResearchTokenUsage;
  /** The same tokens, keyed by the model that answered (loop and COMPRESS kept apart). */
  usageByModel: DeepResearchUsageByModel;
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
    const { loopCap, compressChars } = researcherBudgetSplit(deps.tier, tokenCap);
    const {
      toolOutputs,
      usage: loopUsage,
      usageByModel: loopUsageByModel,
    } = await runResearchLoop({
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
      callerModel: configuredModelName(deps.model),
      maxTurns: deps.tier.maxSearcherTurns,
      toolResultWindow: deps.tier.toolResultWindow,
      tokenCap: loopCap,
      nonce: deps.nonce,
      signal,
      deadlineMs,
      // Default to Date.now like the supervisor's gate — production wires no clock, so
      // without this the time arm would silently never fire (tests pass a fake).
      clock: deps.clock ?? Date.now,
    });
    const gathered = boundToolOutputs(toolOutputs, compressChars);
    const {
      digest,
      usage: compressUsage,
      usageByModel: compressUsageByModel,
    } = await compressResearch({
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
      usageByModel: mergeUsageByModel(loopUsageByModel, compressUsageByModel),
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
      usageByModel: {},
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
    const usageByModel = results.reduce<DeepResearchUsageByModel>(
      (acc, r) => mergeUsageByModel(acc, r.usageByModel),
      {},
    );
    const errors = results
      .map((r) => r.error)
      .filter((error): error is DeepResearchNodeError => Boolean(error));
    return errors.length > 0
      ? { findings, tokenUsage: usage, usageByModel, errors }
      : { findings, tokenUsage: usage, usageByModel };
  };
}
