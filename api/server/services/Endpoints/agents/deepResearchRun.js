const { randomUUID } = require('node:crypto');
const { CacheKeys, Constants, FileContext } = require('librechat-data-provider');
const { HumanMessage, SystemMessage } = require('@langchain/core/messages');
const { Providers, getChatModelClass, createSearchTool } = require('@librechat/agents');
const {
  sendEvent,
  createSafeUser,
  initializeCustom,
  runDeepResearch,
  resolveConfigHeaders,
  loadWebSearchAuth,
  tierToRunBudget,
  GenerationJobManager,
  buildFallbackReport,
  recordCollectedUsage,
  sanitizeErrorForUser,
  resolveDeepResearchTier,
  sanitizeMessageForTransmit,
  createDeepResearchGraph,
  selectChatFileSearchInputs,
  startSovereignSession,
  buildClarifyPrompt,
  parseClarifyOutput,
  formatClarifyMessage,
  buildPlanPrompt,
  parsePlanDecision,
  formatPlanMessage,
  isPlanMessage,
  isStartCommand,
  isCancelCommand,
  extractPlanSteps,
  CANCELLED_MESSAGE,
  reportToPdfBuffer,
  getStorageMetadata,
  getProviderConfig,
  usageFromExchange,
  usageByModelFromExchange,
  mergeUsageByModel,
  disableTitleReasoning,
  leadModelFor,
  workerModelFor,
  reportModelFor,
  compressModelFor,
  DeepResearchConfigError,
} = require('@librechat/api');
const { logger } = require('@librechat/data-schemas');
const { createFileSearchTool } = require('~/app/clients/tools/util/fileSearch');
const { filterRequestFilesByAccess } = require('~/server/services/Files/permissions');
const { loadAuthValues } = require('~/server/services/Tools/credentials');
const { getStrategyFunctions } = require('~/server/services/Files/strategies');
const getLogStores = require('~/cache/getLogStores');
const {
  createFile,
  getFiles,
  getConvo,
  getMessages,
  saveConvo,
  saveMessage,
  spendTokens,
  getMultiplier,
  getConvoFiles,
  updateBalance,
  getCacheMultiplier,
  spendStructuredTokens,
  bulkInsertTransactions,
} = require('~/models');

/** Leading imperative research phrases stripped so the title reads as a TOPIC, not a
 *  command ("проведи исследование рынка CRM" → "Исследование рынка CRM") — the P6 fix. */
const RESEARCH_IMPERATIVE =
  /^(?:пожалуйста,?\s+)?(?:проведи|сделай|выполни|подготовь|составь|собери|дай|найди|изучи|исследуй|проанализируй|разбери)(?:те)?\s+/iu;

/** Capitalize the first code point and truncate to 60 code points, surrogate-safe — a cut
 *  never splits an emoji/astral char into a lone surrogate that renders as a "�" glyph. */
function capitalizeAndTruncateTitle(topic) {
  const chars = [...topic];
  const titled = chars[0].toUpperCase() + chars.slice(1).join('');
  const out = [...titled];
  return out.length > 60 ? `${out.slice(0, 57).join('')}…` : titled;
}

/**
 * Deterministic FALLBACK chat title from the research request (M9/P6) — a capitalized
 * TOPIC, never "New Chat". Used only when the model-generated title
 * ({@link resolveDeepResearchTitle}) is unavailable; a `^`-anchored imperative strip is
 * fragile for arbitrary phrasings, which is why the model title is primary. Shown to the
 * user, never egressed, so a masked/raw request is fine here.
 */
function buildDeepResearchTitle(text) {
  const normalized = (text ?? '').trim().replace(/\s+/g, ' ');
  const topic = normalized.replace(RESEARCH_IMPERATIVE, '').trim() || normalized;
  if (!topic) {
    return 'Глубокое исследование';
  }
  return capitalizeAndTruncateTitle(topic);
}

/**
 * Anonymizer PII placeholders that must never surface in a title. Matches the bare core
 * (`PERSON_1`, `PHONE_2`) AND the bracketed token form (`[[PERSON_1]]`) — the anonymizer emits the
 * bracketed form, so stripping only the core left orphan `[[]]`. Optional 0–2 brackets each side.
 */
const TITLE_PII_PLACEHOLDER = /\[{0,2}\b[A-ZА-Я][A-ZА-Я]{2,}_\d+\b\]{0,2}/g;

/** Normalizes a model-proposed title: first non-empty line, no quotes/markdown/placeholders/trailing dot. */
function cleanModelTitle(raw) {
  const firstLine =
    String(raw ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? '';
  return firstLine
    .replace(TITLE_PII_PLACEHOLDER, '')
    .replace(/[«»"'`]/g, '')
    .replace(/^#+\s*/, '')
    .replace(/\*+/g, '')
    .replace(/[.。]+\s*$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Flattens a LangChain message `content` (string or content-part array) to plain text. */
function extractMessageText(content) {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === 'string' ? part : (part?.text ?? ''))).join(' ');
  }
  return '';
}

/** Default DR title prompt — used only when the endpoint config has no `titlePrompt`.
 *  Mirrors the standard prompt contract: `{convo}` is replaced with the dialogue. */
const DEFAULT_TITLE_PROMPT =
  'Сформулируй короткий заголовок ТЕМЫ исследования на русском: 3–7 слов, именительный падеж, без кавычек, без точки в конце, это тема, а не команда. Не включай имена людей, телефоны, e-mail и служебные метки вида PERSON_1. Верни только текст заголовка.\n\nДиалог:\n{convo}';

/**
 * The SAME title configuration normal chats use (librechat.yaml `titlePrompt`/`titleModel`
 * per endpoint) — resolved with the standard fallback chain from the agents client. DR
 * titles thus obey the tenant's configured rules («Максимум 4 слова», language, style)
 * instead of a second hardcoded rule set. Fail-soft: any resolution error → null (defaults).
 */
function resolveTitleConfig(req, endpoint) {
  const appConfig = req?.config;
  try {
    const providerConfig = getProviderConfig({ provider: endpoint, appConfig });
    return (
      appConfig?.endpoints?.all ??
      appConfig?.endpoints?.[endpoint] ??
      providerConfig?.customEndpointConfig ??
      null
    );
  } catch {
    return null;
  }
}

/**
 * DR chat title: distilled by the CONFIGURED title model/prompt (parity with normal chats)
 * from the (masked) request, so any phrasing ("Меня зовут…, сравни X и Y") still yields a
 * clean subject line — and because it runs on the MASKED question, the user's PII never
 * lands in the title/sidebar. Fail-open: any error or empty result falls back to the
 * deterministic {@link buildDeepResearchTitle} heuristic.
 */
async function resolveDeepResearchTitle({
  req,
  endpoint,
  buildModel,
  leadModelSlug,
  topicText,
  fallbackText,
  signal,
}) {
  const source = (topicText ?? '').trim();
  if (!source) {
    return { title: buildDeepResearchTitle(fallbackText), usage: null, usageByModel: {} };
  }
  try {
    const titleConfig = resolveTitleConfig(req, endpoint);
    /**
     * `titleConvo: false` means "do not spend a model call naming chats". DR honoured every
     * other title setting and ignored this one, so turning titles off platform-wide still
     * left DR generating them. The deterministic heuristic still names the chat, so a DR run
     * never degrades to "New Chat".
     */
    if (titleConfig?.titleConvo === false) {
      return { title: buildDeepResearchTitle(fallbackText), usage: null, usageByModel: {} };
    }
    const configuredModel = titleConfig?.titleModel;
    const modelSlug =
      configuredModel && configuredModel !== 'current_model' ? configuredModel : leadModelSlug;
    const promptTemplate =
      typeof titleConfig?.titlePrompt === 'string' && titleConfig.titlePrompt.includes('{convo}')
        ? titleConfig.titlePrompt
        : DEFAULT_TITLE_PROMPT;
    const model = await buildModel(modelSlug);
    const prompt = [new HumanMessage(promptTemplate.replace('{convo}', `Пользователь: ${source}`))];
    const response = await model.invoke(prompt, { signal });
    const cleaned = cleanModelTitle(extractMessageText(response?.content));
    return {
      title: cleaned ? capitalizeAndTruncateTitle(cleaned) : buildDeepResearchTitle(fallbackText),
      usage: usageFromExchange(prompt, response),
      usageByModel: usageByModelFromExchange(prompt, response, modelSlug),
    };
  } catch (error) {
    logger.warn('[deepResearchRun] title generation failed; using heuristic fallback', error);
    return { title: buildDeepResearchTitle(fallbackText), usage: null, usageByModel: {} };
  }
}

/** Adds two token-usage tallies (either side may be null/partial). */
function sumUsage(a, b) {
  return {
    input: (a?.input ?? 0) + (b?.input ?? 0),
    output: (a?.output ?? 0) + (b?.output ?? 0),
    total: (a?.total ?? 0) + (b?.total ?? 0),
  };
}

/** Soft per-user cap on concurrent active generations gating a new DR start (M1). */
const MAX_CONCURRENT_DR = Number(process.env.DEEP_RESEARCH_MAX_CONCURRENT) || 3;

/**
 * Soft GLOBAL cap on concurrent Deep Research runs across ALL users (M2). A backstop
 * against a pathological burst — a whole team starting a run in the same minute — not a
 * normal-use limit, so the default sits well above the realistic peak (a few to a dozen
 * at ~100 seats). Admission only: exactly like the per-user cap, it can refuse a START
 * but never interrupt a run already in flight, so an admitted research always finishes.
 * Tune via env; 0 or an unparseable value falls back to the default rather than disabling.
 */
const MAX_GLOBAL_DR = Number(process.env.DEEP_RESEARCH_MAX_GLOBAL) || 20;

/**
 * Sentinel: a new DR start is refused at the concurrency cap; short-circuits to a busy
 * report. `scope` selects the message — 'user' (this user has too many running) vs
 * 'global' (the server is saturated) — so the user gets an actionable reason.
 */
class DeepResearchCapError extends Error {
  constructor(scope = 'user') {
    super();
    this.scope = scope;
  }
}

/**
 * Count the user's OTHER active generation jobs (excluding this one) via the job store.
 * NOTE: the default deploy runs the IN-MEMORY store on a single replica — the count is
 * per-process and only becomes cluster-safe when the Redis store is configured. It is
 * also blind to a same-conversation duplicate BY CONSTRUCTION (both submissions share
 * `streamId === conversationId`, and this filters the own id out) — that case is handled
 * by the pre-createJob running-job guard in request.js plus the duplicateStart refusal.
 * A soft proxy for DR concurrency; the economic backstop is H4 billing. Fail-open: a
 * counting error returns 0.
 */
async function countOtherActiveJobs({ streamId, userId, tenantId }) {
  try {
    const ids = (await GenerationJobManager.getActiveJobIdsForUser(userId, tenantId)) ?? [];
    return ids.filter((id) => id !== streamId).length;
  } catch (error) {
    logger.warn('[deepResearchRun] DR admission count failed; allowing run (fail-open)', error);
    return 0;
  }
}

/**
 * Count OTHER active Deep Research runs server-wide (excluding this one) for the global
 * cap. Fail-open: a counting error returns 0 and the run is allowed — a backstop must
 * never itself become a new way for DR to break.
 */
async function countOtherActiveDrJobs(streamId) {
  try {
    return await GenerationJobManager.getActiveDeepResearchCount(streamId);
  } catch (error) {
    logger.warn(
      '[deepResearchRun] global DR admission count failed; allowing run (fail-open)',
      error,
    );
    return 0;
  }
}

/** DR outcomes that yield a genuine, model-written report worth a PDF artifact (D4).
 *  Everything else carries a self-contained notice instead of a report and is skipped: a
 *  concurrency refusal ('limit'), a user Stop ('aborted'), a failed synthesis ('error'),
 *  an empty gather ('nodata') — and 'time', which the run wrapper sets ONLY when the graph
 *  produced NO report (`resultFrom`: a report keeps its own reason), i.e. the text is the
 *  honest "не удалось сформировать отчёт" notice. A PDF of that notice is a useless file. */
const PDF_ELIGIBLE_REASONS = new Set(['completed', 'budget', 'rounds']);

/** Outcomes whose saved text IS a real model report, but with gathering cut short behind it
 *  — the only ones that get stamped `unfinished`. Nothing renders that flag any more (see
 *  where it is set, below); it is the machine record truncated runs are counted from, so
 *  the set has to keep meaning exactly this and nothing wider. Every other outcome saves a
 *  COMPLETE message (a full report, a plan, a Stop, or an honest failure notice with
 *  nothing above it) and is not a truncation of anything. */
const TRUNCATED_REASONS = new Set(['budget', 'rounds']);

/**
 * Machine-readable provenance stamped on the runner's response message (review r2): the
 * client mounts the plan card / report card on `message.drKind`, never on display text.
 * Cancel/error/limit messages carry none — they are plain terminal text.
 *
 * 'aborted' (a user Stop): the next user message must re-plan the ORIGINAL plan with that
 * comment, not start fresh — so the stopped turn IS a followable DR anchor. Note that a
 * budget/rounds run is 'report' (a real model answer, just with gathering cut short →
 * normal chat follow-up); ONLY a user Stop routes back into planning (owner decision,
 * task #21). A failure notice ('time'/'error'/'nodata') carries no drKind — plain text.
 */
function drKindForReason(finalizeReason) {
  if (finalizeReason === 'plan' || finalizeReason === 'clarify') {
    return finalizeReason;
  }
  if (PDF_ELIGIBLE_REASONS.has(finalizeReason)) {
    return 'report';
  }
  if (finalizeReason === 'aborted') {
    return 'aborted';
  }
  return undefined;
}

/**
 * D4: attach the final report as a downloadable PDF on the response message. The frontend
 * renders any non-image `message.files[]` entry as a chip with a download button, so no
 * client change is needed. FAIL-OPEN: any failure logs a warning and leaves the message
 * without a file — a PDF hiccup never breaks the run. Skipped for temporary chats (no
 * orphan files) and non-report outcomes. Must run BEFORE the response is saved so the
 * persisted message carries the file.
 */
async function attachReportPdf({ req, responseMessage, reportMarkdown, title, finalizeReason }) {
  if (req?.body?.isTemporary || !PDF_ELIGIBLE_REASONS.has(finalizeReason)) {
    logger.info(
      `[deepResearchRun] PDF skipped (${req?.body?.isTemporary ? 'temporary chat' : `reason=${finalizeReason}`})`,
    );
    return;
  }
  const markdown = (reportMarkdown ?? '').trim();
  if (!markdown) {
    return;
  }
  try {
    const fileStrategy = req?.config?.fileStrategy;
    const { saveBuffer } = getStrategyFunctions(fileStrategy);
    if (typeof saveBuffer !== 'function') {
      logger.warn(
        `[deepResearchRun] fileStrategy "${fileStrategy}" has no saveBuffer; PDF skipped`,
      );
      return;
    }
    const buffer = await reportToPdfBuffer(markdown, { title: (title || 'Отчёт').trim() });
    const fileId = randomUUID();
    const displayName = `${(title || 'Отчёт').replace(/[\\/]/g, ' ').trim()}.pdf`;
    const filepath = await saveBuffer({
      userId: responseMessage.user,
      buffer,
      fileName: `${fileId}__report.pdf`,
      basePath: 'uploads',
      tenantId: req?.user?.tenantId,
    });
    const file = await createFile(
      {
        file_id: fileId,
        filepath,
        ...getStorageMetadata({ filepath, source: fileStrategy }),
        filename: displayName,
        type: 'application/pdf',
        bytes: buffer.length,
        user: responseMessage.user,
        tenantId: req?.user?.tenantId,
        messageId: responseMessage.messageId,
        conversationId: responseMessage.conversationId,
        source: fileStrategy,
        context: FileContext.message_attachment,
        object: 'file',
        usage: 0,
      },
      true /* disableTTL — the report artifact must not be TTL-swept */,
    );
    if (file) {
      responseMessage.files = [file];
      logger.info(
        `[deepResearchRun] report PDF attached (file_id=${fileId}, bytes=${buffer.length})`,
      );
    } else {
      logger.warn('[deepResearchRun] createFile returned no record; report sent without PDF');
    }
  } catch (error) {
    logger.warn(
      '[deepResearchRun] failed to attach report PDF; sending report without file',
      error,
    );
  }
}

/**
 * Badge-independence (D2 + task #21): TRUE when the message replies to a DR assistant
 * turn — a clarify-questions message OR a plan card. The routing gate uses this so
 * answering questions, or starting/editing/cancelling a plan, ALWAYS continues into DR
 * even when the frontend's `deep_research` flag was lost (toggled off, dropped on the
 * new-chat key transition, etc.). Replying to a DR turn IS the user's intent; without
 * this the reply fell into normal chat and a plain model improvised a source-less
 * "report".
 *
 * Review r2: keys on the persisted machine field `drKind` — NEVER on display text. A
 * normal-chat answer that merely LOOKS like a plan (prose starting with the marker)
 * must not route its follow-up into an expensive research run. Messages created before
 * drKind shipped lose follow-up routing (their cards also stop rendering live buttons
 * client-side, same gate) — accepted for the tiny test-era population.
 * Fail-closed: any error → false (normal chat).
 */
async function isDrFollowUp({ userId, conversationId, parentMessageId }) {
  if (!conversationId || !parentMessageId || parentMessageId === Constants.NO_PARENT) {
    return false;
  }
  try {
    const messages = await getMessages(
      { conversationId, user: userId, messageId: parentMessageId },
      'messageId isCreatedByUser drKind',
    );
    const parent = Array.isArray(messages) ? messages[0] : null;
    if (!parent || parent.isCreatedByUser === true) {
      return false;
    }
    // 'aborted' too: a comment after a Stop re-plans the original plan (task #21 edit).
    return parent.drKind === 'plan' || parent.drKind === 'clarify' || parent.drKind === 'aborted';
  } catch (error) {
    logger.warn('[deepResearchRun] DR follow-up check failed; routing to normal chat', error);
    return false;
  }
}

/** Max DR-exchange messages walked when assembling the dialogue (bounds runaway edits). */
const MAX_DR_CHAIN = 24;

/**
 * Coarse 0..1 progress for the live card (task #21) from a graph progress event.
 *
 * `maxRounds` is the CONFIGURED round cap, and a run almost never reaches it — the budget
 * gate stops first. Dividing by it made the bar a promise the run does not keep: with a cap
 * of 6 and a run that affords 2, the bar crawled to 0.35 and then jumped to 0.92, and the
 * plan checklist skipped two steps in one go on the way.
 *
 * So the curve approaches its ceiling instead of racing a denominator: each round adds less
 * than the one before and the bar never stalls, never fills early, and needs no forecast of
 * how many rounds the money will buy. It stays below the 0.92 the report step claims.
 */
function drProgressFraction(event, maxRounds, searchCount) {
  if (event.type === 'scope') {
    return 0.08;
  }
  if (event.type === 'report') {
    return 0.92;
  }
  const round = Math.max(0, event.round || searchCount || 0);
  return 0.1 + 0.75 * (round / (round + 1.5));
}

/** RU "current action" line for the live card (task #21) from a graph progress event. */
function drProgressAction(event) {
  if (event.type === 'scope') {
    return 'Определяет область исследования';
  }
  if (event.type === 'report') {
    return 'Формирует отчёт';
  }
  return event.subQuestion ? `Исследует: ${event.subQuestion}` : 'Исследует источники';
}

/**
 * Report-phase progress, derived from HOW LONG the report has been writing.
 *
 * The REPORT node is one long completion — on a deep run it holds the screen for three to
 * four minutes with no state update of its own. Until the engine learned to announce the
 * phase from the supervisor's concluding pass, the card spent those minutes showing the
 * LAST sub-question at a bar that never moved: not merely idle, but wrong.
 *
 * Elapsed time, not text written. Every DR node model is deliberately built
 * `streaming: false` (see `buildNodeModel`: the streaming branch estimates usage through a
 * tiktoken download a sovereign deployment cannot reach, which cost ~200 s of dead retries
 * per call), so token callbacks deliver the whole report in ONE burst when the node is
 * already done. A length-of-text signal reads beautifully in a test with a streaming fake
 * and does exactly nothing in production. The clock does not lie either way.
 *
 * Asymptotic on purpose. Nothing here knows how long a given report will take, so a curve
 * that could reach its ceiling on its own would simply freeze again one number higher;
 * this one starts at the 0.92 the report step already claimed and approaches 0.99 without
 * arriving. Only the run's end fills the bar.
 */
const REPORT_HALFWAY_MS = 3 * 60_000;
/** Ceiling the curve approaches; only the run's end fills the bar. */
const REPORT_CEILING = 0.99;
function drReportFraction(elapsedMs) {
  const elapsed = Math.max(0, elapsedMs);
  /* The floor is the report step's own number, read from the curve above rather than
   * repeated here — two copies of 0.92 would drift the day one of them is tuned. */
  const floor = drProgressFraction({ type: 'report' }, 0, 0);
  return floor + (REPORT_CEILING - floor) * (elapsed / (elapsed + REPORT_HALFWAY_MS));
}

/** Below this the phase has only just started and the plain label reads better than
 *  a counter ticking up from zero. */
const REPORT_ELAPSED_FLOOR_MS = 30_000;

/** RU action line for the report phase, carrying the elapsed time once there is some. */
function drReportAction(elapsedMs) {
  if (elapsedMs < REPORT_ELAPSED_FLOOR_MS) {
    return 'Формирует отчёт';
  }
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const elapsed = minutes > 0 ? `${minutes} мин ${seconds} с` : `${seconds} с`;
  return `Формирует отчёт — ${elapsed}`;
}

/** How often the report phase refreshes the card while the model writes. Every tick is an
 *  SSE event and a job-store write, so it is a heartbeat, not an animation. */
const REPORT_TICK_MS = 5_000;

/**
 * Renders the collected DR exchange (top-down) + the current unsaved turn text as a
 * labeled transcript for the plan decision / research input. START/CANCEL command
 * messages carry no research content and are skipped.
 */
function buildDialogueTranscript(chain, currentText) {
  const blocks = [];
  let seenOriginal = false;
  for (const message of chain) {
    const text = (message.text ?? '').trim();
    if (!text) {
      continue;
    }
    if (message.isCreatedByUser === true) {
      if (isStartCommand(text) || isCancelCommand(text)) {
        continue;
      }
      blocks.push(
        seenOriginal ? `Ответ пользователя:\n${text}` : `Исходный запрос пользователя:\n${text}`,
      );
      seenOriginal = true;
    } else if (message.drKind === 'clarify') {
      blocks.push(`Уточняющие вопросы:\n${text}`);
    } else if (message.drKind === 'plan') {
      blocks.push(`Предложенный план:\n${text}`);
    }
  }
  const current = (currentText ?? '').trim();
  if (current && !isStartCommand(current) && !isCancelCommand(current)) {
    blocks.push(
      seenOriginal ? `Ответ/правка пользователя:\n${current}` : `Запрос пользователя:\n${current}`,
    );
  }
  return blocks.length > 0 ? `Диалог по задаче исследования.\n\n${blocks.join('\n\n')}` : current;
}

/**
 * Task #21 plan gate: classifies a DR turn from its parent chain and assembles the
 * dialogue the decision/research consumes. Walks up from the parent collecting the
 * exchange (original request → clarify Q&A → plan → this turn) until a non-DR boundary.
 * Fail-open: no DR parent or any load error → a fresh turn (research the raw request).
 *
 * Review r2: parent/boundary detection keys on the persisted `drKind` field (provenance),
 * not display text. `duplicateStart` flags a plan-start whose plan ALREADY has another
 * persisted START child — the second tab of a double-submit, or a re-click after the run
 * finished — so the runner refuses instead of launching a second identical research.
 * `currentUserMessageId` is excluded from that check: on a regenerate the current turn
 * reuses the existing START message id, which must not count as its own duplicate.
 *
 * Task #21 plan edit after a Stop: a drKind='aborted' parent is a DR continuation too —
 * the walk climbs past it (and past any earlier abort) to the original plan, and the
 * comment is classified 'plan-edit', so Stop + a comment re-plans the ORIGINAL plan with
 * that comment. The aborted anchor's own text (the STOPPED notice / partial) is NOT added
 * to the dialogue — only [original request, plan, comment] feed the re-plan.
 *
 * kind: 'fresh' | 'clarify-answer' | 'plan-start' | 'plan-cancel' | 'plan-edit'.
 */
async function buildDrTurnContext({
  userId,
  conversationId,
  parentMessageId,
  text,
  currentUserMessageId,
}) {
  const fresh = {
    kind: 'fresh',
    dialogue: null,
    originalRequest: text ?? '',
    parentText: '',
    duplicateStart: false,
  };
  if (!parentMessageId || !conversationId || parentMessageId === Constants.NO_PARENT) {
    return fresh;
  }
  try {
    const messages = await getMessages(
      { conversationId, user: userId },
      'messageId parentMessageId text isCreatedByUser drKind',
    );
    if (!Array.isArray(messages) || messages.length === 0) {
      return fresh;
    }
    const byId = new Map(messages.map((m) => [m.messageId, m]));
    const parent = byId.get(parentMessageId);
    if (!parent || parent.isCreatedByUser === true) {
      return fresh;
    }
    const parentIsClarify = parent.drKind === 'clarify';
    const parentIsPlan = parent.drKind === 'plan';
    // A Stop leaves a drKind='aborted' anchor; a comment on it re-plans the ORIGINAL plan
    // (task #21 edit). A completed 'report' is deliberately NOT here — a follow-up on a
    // finished report is normal chat (owner decision).
    const parentIsAborted = parent.drKind === 'aborted';
    if (!parentIsClarify && !parentIsPlan && !parentIsAborted) {
      return fresh;
    }

    const chain = [];
    const guard = new Set();
    let cursor = parent;
    while (cursor && !guard.has(cursor.messageId) && chain.length < MAX_DR_CHAIN) {
      guard.add(cursor.messageId);
      chain.push(cursor);
      const up = cursor.parentMessageId ? byId.get(cursor.parentMessageId) : null;
      const upIsDr =
        up && up.isCreatedByUser !== true
          ? up.drKind === 'clarify' || up.drKind === 'plan' || up.drKind === 'aborted'
          : Boolean(up);
      if (!upIsDr) {
        break;
      }
      cursor = up;
    }
    chain.reverse();

    const originalMsg = chain.find((m) => m.isCreatedByUser === true);
    const originalRequest = (originalMsg?.text ?? '').trim() || (text ?? '');
    const dialogue = buildDialogueTranscript(chain, text);

    let kind;
    if (parentIsClarify) {
      kind = 'clarify-answer';
    } else if (parentIsAborted) {
      // After a Stop there is no live plan card to start or cancel — any comment re-plans.
      kind = 'plan-edit';
    } else if (isStartCommand(text)) {
      kind = 'plan-start';
    } else if (isCancelCommand(text)) {
      kind = 'plan-cancel';
    } else {
      kind = 'plan-edit';
    }
    const duplicateStart =
      kind === 'plan-start' &&
      messages.some(
        (m) =>
          m.parentMessageId === parent.messageId &&
          m.isCreatedByUser === true &&
          m.drKind === 'start' &&
          m.messageId !== currentUserMessageId,
      );
    return { kind, dialogue, originalRequest, parentText: parent.text ?? '', duplicateStart };
  } catch (error) {
    logger.warn(
      '[deepResearchRun] failed to build DR turn context; treating as a fresh request',
      error,
    );
    return fresh;
  }
}

/**
 * D2 turn 1: ask the lead model whether the request is specific enough to research now or
 * needs clarifying questions. Runs on the MASKED question. Fail-open: any error → PROCEED
 * (research starts rather than the user being nagged with questions). Used on the plan-gate
 * OFF path; the plan gate ON path uses {@link runPlanDecision}.
 */
async function runClarifyCheck({ buildModel, leadModelSlug, question, now, signal }) {
  try {
    const model = await buildModel(leadModelSlug);
    const prompt = [new SystemMessage(buildClarifyPrompt({ now })), new HumanMessage(question)];
    const response = await model.invoke(prompt, { signal });
    return {
      ...parseClarifyOutput(extractMessageText(response?.content)),
      usage: usageFromExchange(prompt, response),
      usageByModel: usageByModelFromExchange(prompt, response, leadModelSlug),
    };
  } catch (error) {
    if (signal?.aborted) {
      return { action: 'ABORTED', questions: [], usage: null, usageByModel: {} };
    }
    logger.warn('[deepResearchRun] clarify check failed; proceeding to research', error);
    return { action: 'PROCEED', questions: [], usage: null, usageByModel: {} };
  }
}

/**
 * Task #21 plan gate turn 1/2: ask the lead model to decide CLARIFY (ask questions) /
 * PLAN (present a plan card) / PROCEED (research now). Runs on the MASKED input.
 *
 * Review r2 — the gate fails CLOSED: a model error or unparseable output returns PLAN
 * (the runner substitutes {@link FALLBACK_PLAN_STEPS}), because the gate's whole contract
 * is explicit user confirmation before the most expensive action in the product; a model
 * hiccup must present a card, never silently launch a run. A user Stop during the call
 * is not a model failure — it returns the distinct ABORTED action and the runner exits
 * without saving a response or billing.
 */
async function runPlanDecision({
  buildModel,
  leadModelSlug,
  input,
  now,
  signal,
  allowClarify,
  isRefinement = false,
}) {
  try {
    const model = await buildModel(leadModelSlug);
    const prompt = [
      new SystemMessage(buildPlanPrompt({ now, allowClarify, isRefinement })),
      new HumanMessage(input),
    ];
    const response = await model.invoke(prompt, { signal });
    return {
      ...parsePlanDecision(extractMessageText(response?.content), { allowClarify }),
      usage: usageFromExchange(prompt, response),
      usageByModel: usageByModelFromExchange(prompt, response, leadModelSlug),
    };
  } catch (error) {
    if (signal?.aborted) {
      return {
        action: 'ABORTED',
        questions: [],
        title: '',
        steps: [],
        usage: null,
        usageByModel: {},
      };
    }
    logger.warn('[deepResearchRun] plan decision failed; failing CLOSED to a plan card', error);
    return { action: 'PLAN', questions: [], title: '', steps: [], usage: null, usageByModel: {} };
  }
}

/**
 * Deterministic plan shown when the decision model failed or returned garbage — keeps
 * the confirmation gate standing with zero model dependency. Начать then runs the graph
 * as usual (which surfaces its own clear error if the provider is still down).
 */
const FALLBACK_PLAN_STEPS = [
  'Собрать и изучить источники по теме запроса',
  'Проверить и сопоставить ключевые факты и данные',
  'Сформировать структурированный отчёт с выводами',
];

/**
 * Terminal refusal for a duplicate START (review r2): the plan already has another
 * persisted START child — a second tab fired the same start, or the user re-clicked
 * after the run finished. Carries no marker/drKind, so follow-ups route to normal chat;
 * the original run keeps its stream untouched.
 */
const DUPLICATE_START_MESSAGE =
  'Это исследование уже запущено. Дождитесь завершения — отчёт появится в этом чате.';

/**
 * Terminal notice for a Stop that collected NO report text (the user aborted before the
 * report was synthesised). It replaces the empty text a bare abort would otherwise save,
 * so the run leaves a followable anchor (drKind='aborted') instead of a dangling id — the
 * next user message re-plans the ORIGINAL plan with that comment (task #21 plan edit). It
 * also answers "what now?" inline: describe the change and the plan rebuilds.
 */
const STOPPED_MESSAGE =
  'Исследование остановлено. Напишите, что изменить в плане, — и я пересоберу его с учётом ваших правок.';

/**
 * Terminal result for a Stop that lands before the graph runs (during the clarify check or
 * the plan decision). It exists because a DR run owns its own finalization: abort sets
 * `producerFinalizesOnAbort`, so `abortJob` deliberately emits NO final and waits for this
 * run to emit one (packages/api/src/stream/GenerationJobManager.ts). Returning early from
 * the gate emitted nothing at all, so the client kept spinning until the reaper noticed —
 * the very failure the abort contract is written to avoid. Routing the stop through the
 * shared finalize tail instead reuses the graph-phase behaviour verbatim: the STOPPED
 * notice, a re-plannable `drKind='aborted'` anchor, no model title call, sovereign dropped.
 */
const STOPPED_RESULT = () => ({
  finalReport: STOPPED_MESSAGE,
  finalizeReason: 'aborted',
  usage: { input: 0, output: 0, total: 0 },
  findings: [],
});

/** The stock default conversation title — a row still carrying it has not been named yet. */
const DEFAULT_CONVO_TITLE = 'New Chat';

/**
 * Reliable-first (v1) runner for the rebuilt StateGraph Deep Research engine.
 * Runs ENTIRELY behind `deepResearch.useNewEngine`; the legacy engine is the
 * default and this path is never entered unless the flag is on, so it cannot
 * regress existing DR. v1 delivers the full report as ONE assistant message at
 * the end (no token streaming yet — that ships after the SSE frame format is
 * confirmed against a live lab capture). Progress is logged server-side for now.
 *
 * LAB-VERIFY markers below flag the details that can only be confirmed on lab.
 */

/** Builds a `BaseChatModel` for `model` routed under endpoint `1ma` (anonymizer baseURL). */
async function buildNodeModel({
  req,
  db,
  endpoint,
  model,
  passthroughHeaders,
  providerRouting,
  disableReasoning,
}) {
  const { llmConfig, configOptions, provider } = await initializeCustom({
    req,
    endpoint,
    model_parameters: { model },
    db,
  });
  // LAB-VERIFY (unknown #1): `1ma` is OpenAI-compatible, so default to OPENAI when
  // initializeCustom returns no explicit provider. Confirm vs librechat.yaml `1ma`.
  const resolvedProvider = provider ?? llmConfig.provider ?? Providers.OPENAI;
  const { provider: _omit, ...clientOptions } = llmConfig;
  /**
   * Title calls must not reason. The `1ma` endpoint is declared as OpenRouter, so
   * `getOpenAILLMConfig` sets `include_reasoning` on every non-Anthropic model; the normal
   * chat path strips it for the title call and DR never did. This repo's own config records
   * the measurement that made it a requirement: 728 hidden billed tokens and a median 8.3 s
   * instead of 0.9 s — paid on the tail of every single run.
   *
   * Applied BEFORE `modelKwargs` is assembled below, so the `reasoning: { enabled: false }`
   * it writes is carried through with the provider pin rather than overwritten by it.
   */
  if (disableReasoning) {
    disableTitleReasoning(clientOptions);
  }
  // Track B: passthrough headers tell the anonymizer NOT to mask this model call, so public
  // web/derivatives stay intact — user PII is masked at the source (question + file_search).
  // Merged into defaultHeaders so EVERY graph model call carries them. null → legacy masking.
  const finalConfig = passthroughHeaders
    ? {
        ...configOptions,
        defaultHeaders: { ...(configOptions?.defaultHeaders ?? {}), ...passthroughHeaders },
      }
    : configOptions;
  /**
   * Resolve header placeholders before the model is built, exactly as the normal agent
   * path does (packages/api/src/agents/run.ts). `initializeCustom` leaves `{{LIBRECHAT_*}}`
   * templates unexpanded, so without this the `1ma` endpoint's
   * `x-librechat-user-id: {{LIBRECHAT_USER_ID}}` header — the one the anonymizer forwards
   * to the credit ledger so a spend is attributed to a user — reaches the anonymizer as the
   * literal placeholder, fails the ledger's ObjectId check, and lands the whole DR run's
   * cost against no user. The header is internal-only (never forwarded upstream) and the id
   * is an opaque ObjectId, so this restores intended billing metadata without crossing the
   * PII boundary. Mutates `finalConfig.defaultHeaders` in place; idempotent under reuse.
   */
  resolveConfigHeaders({
    llmConfig: { configuration: finalConfig },
    user: createSafeUser(req?.user),
    body: req?.body,
  });
  /**
   * OpenRouter provider routing for this tier (`deepResearch.modes.<tier>.provider`).
   *
   * Deep Research builds its own clients and never saw the model spec's `addParams`, so
   * every DR call has always gone out UNPINNED — OpenRouter picked the platform. That was
   * harmless while the tier ran a slug served cheaply and identically everywhere; it stopped
   * being harmless once balanced moved to `deepseek-v4-pro-0813`, whose nine platforms differ
   * 2x in price and one of which serves it fp8-quantised. Measured on the stand: the first
   * live call landed on the quantised one.
   *
   * `provider` is not an OpenAI parameter, so it travels in `modelKwargs`, which LangChain
   * spreads into the request body — the same route the "Авто" card's own pin already takes.
   * Merged UNDER the tier's value so an endpoint/spec-level pin that reached `llmConfig`
   * cannot override the tier's explicit choice, and omitted entirely when unset, which
   * leaves the pre-existing unpinned behaviour byte-identical.
   */
  const modelKwargs = providerRouting
    ? { ...(clientOptions.modelKwargs ?? {}), provider: providerRouting }
    : clientOptions.modelKwargs;
  const ModelClass = getChatModelClass(resolvedProvider);
  /**
   * Non-streaming on purpose. Every DR node calls `model.invoke()` and consumes the whole
   * answer at once (see the v1 note above — no token streaming), but `getOpenAIConfig`
   * defaults `streaming: true`, and with it LangChain's `_generate` takes the stream branch
   * and finishes by ESTIMATING usage: `_getEstimatedTokenCountFromPrompt` +
   * `_getNumTokensFromGenerations` both call `getNumTokens`, which downloads the tiktoken
   * ranks from tiktoken.pages.dev. That host is unreachable from a sovereign deployment, and
   * the download sits behind @langchain/core's module-level AsyncCaller (6 retries, ~105 s
   * per ladder, not abort-aware), so every DR model call was paying ~200 s of dead retries —
   * which read as "Deep Research hangs" and pushed the finalize tail past the point where the
   * client is still listening. The non-streaming branch reads the provider's real `usage`
   * instead, so this is also the more accurate path.
   */
  return new ModelClass({
    ...clientOptions,
    ...(modelKwargs ? { modelKwargs } : {}),
    streaming: false,
    configuration: finalConfig,
  });
}

/**
 * Resolves the anonymizer connection (baseURL + client token) for `endpoint` from the same
 * initializeCustom config the models use, so Track B's detect/restore calls hit the exact
 * anonymizer the model traffic egresses through. Returns null when no baseURL/apiKey is
 * exposed (→ sovereign masking stays off and DR runs the legacy full-masking path).
 */
async function resolveAnonymizerConnection({ req, db, endpoint, model }) {
  const { llmConfig, configOptions } = await initializeCustom({
    req,
    endpoint,
    model_parameters: { model },
    db,
  });
  const baseURL = configOptions?.baseURL;
  const apiKey = llmConfig?.apiKey;
  if (typeof baseURL !== 'string' || !baseURL || typeof apiKey !== 'string' || !apiKey) {
    return null;
  }
  return { baseURL, apiKey };
}

/**
 * The endpoint's own per-model price table, resolved from the SAME initializeCustom the
 * models are built from. Returns undefined when the endpoint declares none, which is
 * exactly the pre-existing behaviour (family-wide fallback). Never throws: a pricing
 * lookup must not be able to fail a research run.
 */
async function resolveEndpointPricing({ req, db, endpoint, model }) {
  try {
    const { endpointTokenConfig } = await initializeCustom({
      req,
      endpoint,
      model_parameters: { model },
      db,
    });
    return endpointTokenConfig;
  } catch (error) {
    logger.warn('[deepResearchRun] endpoint pricing unavailable; billing falls back', error);
    return undefined;
  }
}

/**
 * file_search scoped to ONLY the conversation's embedded files (bug ② fix) AND
 * authorized PER FILE through the same guard the standard agent path uses (C1).
 * `conversationId` arrives from the client (it is the streamId) and `getConvoFiles`
 * has no userId filter, and owning a conversation does NOT imply owning every file
 * in it (a fork/import/another member's project source can carry a foreign file_id).
 * So we never trust conversation membership: `filterRequestFilesByAccess` keeps files
 * the caller owns and, for non-owned files, admits them only when access genuinely
 * exists. DR runs as an EPHEMERAL agent, for which that guard grants no shared files —
 * so only the caller's own documents survive, closing the cross-tenant read.
 */
/**
 * The failure sentences `file_search` RETURNS instead of throwing.
 *
 * Source: api/app/clients/tools/util/fileSearch.js — the auth failure, the "RAG is
 * unreachable" case (its own comment insists this is NOT "no hits"), and the empty result.
 * If those sentences are reworded there, the guard test below goes red and points here.
 */
const FILE_SEARCH_FAILURE_MARKERS = [
  'There was an error authenticating the file search request.',
  'The document search service is temporarily unavailable.',
  'No content found in the files.',
];

/**
 * Makes a tool that REPORTS failure in its return value fail the way the graph understands.
 *
 * The research loop decides "this call produced nothing" from a THROW (see `executeToolCall`
 * in the engine): a thrown call is shown to the model and kept out of the gathered material.
 * `web_search` throws, so #411 closed the hole for it. `file_search` does not — it returns a
 * plain sentence — so its failures kept flowing into the material, were compressed into a
 * digest, passed `hasResearchMaterial`, and came back as a confident report with a PDF built
 * out of "The document search service is temporarily unavailable."
 *
 * Wrapped HERE rather than changed in the tool itself: the tool is shared with the ordinary
 * chat path, where a returned sentence is exactly the right behaviour — the model reads it
 * and tells the user. Only Deep Research needs it to be a failure.
 */
function failOnToolReportedError(tool, markers) {
  if (!tool || typeof tool.invoke !== 'function') {
    return tool;
  }
  const original = tool.invoke.bind(tool);
  tool.invoke = async (input, config) => {
    const result = await original(input, config);
    const text = typeof result === 'string' ? result : result?.content;
    if (typeof text === 'string' && markers.some((marker) => text.startsWith(marker))) {
      throw new Error(text);
    }
    return result;
  };
  return tool;
}

async function buildChatFileSearchTool({ req, userId, conversationId, transformContent }) {
  if (!conversationId) {
    return null;
  }
  // M2: a DB hiccup here must degrade to RAG-less (like web_search), never reject the
  // whole run's Promise.all and bypass the always-report guarantee.
  try {
    const convoFileIds = (await getConvoFiles(conversationId)) ?? [];
    if (convoFileIds.length === 0) {
      return null;
    }
    const embeddedFiles =
      (await getFiles({ file_id: { $in: convoFileIds }, embedded: true }, null, {
        text: 0,
        fullText: 0,
      })) ?? [];
    const authorized = await filterRequestFilesByAccess({
      files: embeddedFiles,
      userId,
      role: req?.user?.role,
      agentId: Constants.EPHEMERAL_AGENT_ID,
    });
    const files = selectChatFileSearchInputs(authorized);
    if (files.length === 0) {
      return null;
    }
    return failOnToolReportedError(
      createFileSearchTool({ userId, files, fileCitations: true, transformContent }),
      FILE_SEARCH_FAILURE_MARKERS,
    );
  } catch (error) {
    logger.warn('[deepResearchRun] file_search unavailable; running without chat-file RAG', error);
    return null;
  }
}

/** web_search tool when search is configured/authenticated; null otherwise (RAG-only). */
async function buildWebSearchTool({ req, userId }) {
  try {
    const auth = await loadWebSearchAuth({
      userId,
      webSearchConfig: req.config?.webSearch,
      loadAuthValues,
      throwError: false,
    });
    if (!auth?.authenticated) {
      return null;
    }
    return createSearchTool({ ...auth.authResult, logger });
  } catch (error) {
    logger.warn('[deepResearchRun] web_search unavailable; running RAG-only', error);
    return null;
  }
}

/**
 * Splits a run's usage into one billable entry per model that ANSWERED.
 *
 * The engine used to hand billing ONE aggregate figure, priced under the lead model's slug.
 * On the balanced tier that charges every worker and COMPRESS token at the lead's rate —
 * the tier runs `deepseek-v4-pro-0813` as lead and `deepseek-v4-flash-0731` as worker, and
 * the bulk of a run's tokens are the worker's. The journal is not the money the client pays
 * (that comes from the credit ledger, priced by OpenRouter itself), but it IS the only
 * record that knows WHICH CHAT spent what, so a per-chat cost view built on it would
 * inherit the distortion.
 *
 * The aggregate stays the authority on the TOTAL. If the split does not add up to it, the
 * split is wrong — a node that forgot to report its model — and billing falls back to the
 * single-entry behaviour instead of charging a number the run never measured. The
 * discrepancy is logged rather than swallowed.
 *
 * Keys are the models that ANSWERED, not the ones configured: the "Авто" card's fallback
 * list travels to the proxy, so OpenRouter may serve a busy slug from the next one on it.
 *
 * Pure and exported so a test can assert the split without a database.
 *
 * @returns {{entries: Array<{model: string, input_tokens: number, output_tokens: number}>,
 *            note: string}}
 */
function buildDeepResearchCollectedUsage({ model, usage, usageByModel }) {
  const single = [{ model, input_tokens: usage.input, output_tokens: usage.output }];
  const perModel = Object.entries(usageByModel ?? {});
  if (perModel.length === 0) {
    return { entries: single, note: `no per-model usage reported; billed under ${model}` };
  }
  const sum = perModel.reduce(
    (acc, [, u]) => ({
      input: acc.input + (u.input ?? 0),
      output: acc.output + (u.output ?? 0),
      estimated: acc.estimated + (u.estimated ?? 0),
    }),
    { input: 0, output: 0, estimated: 0 },
  );
  if (sum.input !== usage.input || sum.output !== usage.output) {
    return {
      entries: single,
      note:
        `per-model split does not add up (split ${sum.input}/${sum.output} vs run ` +
        `${usage.input}/${usage.output}) — billed under ${model} instead`,
    };
  }
  /**
   * `usageFromExchange` falls back to a length proxy when the provider reports no
   * `usage_metadata`. Those tokens are billed exactly like reported ones — that is what the
   * fallback is for — but anyone reconciling the journal against the OpenRouter invoice
   * needs to know which of the two figures they are arguing with.
   */
  const estimatedNote =
    sum.estimated > 0
      ? `; ${sum.estimated} of those tokens are a LENGTH ESTIMATE (provider reported no usage)`
      : '';
  return {
    entries: perModel.map(([name, u]) => ({
      model: name,
      input_tokens: u.input,
      output_tokens: u.output,
    })),
    note:
      `split across ${perModel.length} model(s): ` +
      perModel.map(([name, u]) => `${name} ${u.input}+${u.output}`).join(', ') +
      estimatedNote,
  };
}

/**
 * Bills a completed or partial DR run (H4), one journal entry per answering model. DR usage
 * never enters the job's collectedUsage, so the /abort middleware bills a different (empty)
 * source and there is no double-spend. Mirrors the deps of
 * abortMiddleware.spendCollectedUsage. Failures are logged, never thrown.
 *
 * `endpointTokenConfig` is the endpoint's own price table (librechat.yaml
 * `endpoints.custom[].tokenConfig`). Without it `getMultiplier` falls back to the
 * FAMILY-WIDE table in data-schemas — 0.28/0.42 for every `deepseek`, 0.8/2.4 for every
 * `claude-` — which is wrong for every model this tier actually runs. Measured on the
 * stand 2026-08-20: a run on `deepseek-v4-pro-0813` (real 1.32/3.96) was recorded at
 * 0.28/0.42, understating it ~3x; the deep tier's Opus 5 (real 5/25) was understated
 * 6-10x. The chat path has passed this config all along; DR simply never did, so the
 * table in the config looked applied and silently was not.
 */
async function billDeepResearchUsage({
  userId,
  conversationId,
  messageId,
  model,
  usage,
  usageByModel,
  endpointTokenConfig,
}) {
  if (!usage || usage.total <= 0) {
    return;
  }
  const { entries, note } = buildDeepResearchCollectedUsage({ model, usage, usageByModel });
  logger.info(`[deepResearchRun] billing DR usage — ${note}`);
  try {
    await recordCollectedUsage(
      {
        spendTokens,
        spendStructuredTokens,
        pricing: { getMultiplier, getCacheMultiplier },
        bulkWriteOps: { insertMany: bulkInsertTransactions, updateBalance },
      },
      {
        user: userId,
        conversationId,
        messageId,
        model,
        context: 'deep_research',
        collectedUsage: entries,
        endpointTokenConfig,
      },
    );
  } catch (error) {
    logger.error('[deepResearchRun] failed to record DR token usage', error);
  }
}

/**
 * Runs the new DR engine and persists + emits the final report.
 *
 * @param {object} params
 * @param {import('express').Request} params.req
 * @param {import('express').Response} params.res
 * @param {string} params.streamId
 * @param {AbortSignal} params.signal  The job's single AbortController signal.
 * @param {string} params.endpoint     The conversation endpoint (e.g. '1ma').
 * @param {string} params.conversationModel  The user's selected model (worker fallback).
 * @param {string} params.userId
 * @param {string} params.conversationId
 * @param {string} params.parentMessageId
 * @param {string} params.responseMessageId
 * @param {string} params.sender
 * @param {string} [params.endpointType]  The endpoint's param family, persisted with the
 *   conversation so its settings stay parseable (a custom endpoint name is not a schema key).
 * @param {object} params.userMessage  The preliminary user message (for the final event).
 * @param {string} params.text         The user's research request.
 * @param {object} [params.turn]       Precomputed DR turn context (request.js classifies
 *                                     once for routing; passing it avoids a second
 *                                     full-conversation load here).
 * @param {number} [params.jobCreatedAt]  This run's job creation timestamp — the stale-job
 *                                     guard skips the final emit when another submission
 *                                     replaced the job mid-run.
 */
async function runNewDeepResearch(params) {
  const {
    req,
    res,
    streamId,
    signal,
    endpoint,
    endpointType,
    conversationModel,
    userId,
    conversationId,
    parentMessageId,
    responseMessageId,
    sender,
    userMessage,
    text,
    turn: precomputedTurn = null,
    jobCreatedAt = null,
  } = params;

  // The user message must leave the run in the normal-path shape (sender/isCreatedByUser,
  // else saveMessage persists an authorless AI turn) — enriched ONCE and reused for the
  // created event, the DB save, and the final event. conversationId precedes the spread
  // as a fallback only: without it saveMessage silently refuses to persist.
  const requestMessage = userMessage
    ? { conversationId, ...userMessage, sender: 'User', isCreatedByUser: true }
    : null;

  const reqCtx = {
    userId,
    isTemporary: req?.body?.isTemporary,
    interfaceConfig: req?.config?.interfaceConfig,
  };

  // H1: emit `created` up front so the job is flagged createdEventEmitted=true and the
  // user message is persisted to the job store. Without it, a Stop during the (content-
  // less) research phase looks like an "early abort" to abortJob, which wipes the question
  // and bounces the user into an empty new chat. emitChunk is a no-op once aborted, so this
  // must run before any await that the user could interrupt. Mirrors the agent path's onStart.
  if (streamId && requestMessage) {
    await GenerationJobManager.emitChunk(streamId, {
      created: true,
      message: requestMessage,
      streamId,
    });
  }

  /** Pre-plan phase snapshot (round 23, item 3): between `created` and the first
   * graph/plan event the server used to be silent for the whole preparation —
   * the client showed only the generic waiting label (DR_REPAIR_Plan §1). These
   * one-line snapshots ride the existing `dr_progress` channel (buffered for
   * late subscribers by GenerationJobManager.earlyEventBuffer), so the client
   * can label the wait («Готовлю агента» → «Думаю над планом»). Fire-and-forget,
   * mirroring onProgress: a slow emit must never block the run. */
  const emitDrPhase = (phase) => {
    /* Same contract as onProgress (:'emits NO dr_progress when the plan gate is
     * off'): legacy gate-off runs stay silent. planGateEnabled is derived later
     * from the same config value, so read it directly here. */
    if (!streamId || req.config?.deepResearch?.planGate !== true) {
      return;
    }
    Promise.resolve(
      GenerationJobManager.emitChunk(streamId, {
        event: 'dr_progress',
        data: { phase, steps: [], action: '', searches: 0, progress: 0 },
      }),
    ).catch(() => {});
  };
  emitDrPhase('prepare');

  const db = { getFiles, getConvoFiles, getConvo };
  const tier = resolveDeepResearchTier(req.config?.deepResearch);
  const leadModelSlug = leadModelFor(tier, conversationModel);
  // Stable per-run id keying the anonymizer's server-side substitution map (Track B) AND the
  // engine's configurable.runId — the SAME value, so question-mask and report-restore share one map.
  const runId = streamId ?? responseMessageId;
  // L4: dedup model clients by slug — lead and report are usually the same model, so
  // cache the in-flight build promise and reuse one instance (clients are stateless
  // per-call, so sharing across nodes is safe) instead of building the same slug twice.
  const modelCache = new Map();
  // Track B: assigned once (before any model is built) when the sovereign session is active, so
  // every graph model call carries the anonymizer passthrough headers. null → legacy full-masking.
  let passthroughHeaders = null;
  const buildModel = (model) => {
    let pending = modelCache.get(model);
    if (!pending) {
      pending = buildNodeModel({
        req,
        db,
        endpoint,
        model,
        passthroughHeaders,
        providerRouting: tier.provider,
      });
      modelCache.set(model, pending);
    }
    return pending;
  };
  /**
   * The title model is built separately, under its OWN cache key, and that separation is the
   * point: `buildModel` caches by slug alone, and the configured `titleModel` is the very
   * flash slug the researchers run on. Reusing it would disable reasoning for every
   * researcher in the run as a side effect of fixing the title call.
   */
  const buildTitleModel = (model) => {
    const key = `title:${model}`;
    let pending = modelCache.get(key);
    if (!pending) {
      pending = buildNodeModel({
        req,
        db,
        endpoint,
        model,
        passthroughHeaders,
        providerRouting: tier.provider,
        disableReasoning: true,
      });
      modelCache.set(key, pending);
    }
    return pending;
  };

  // M2: any failure assembling the models/tools/graph (a missing key, bad endpoint
  // config, a model without tool-calling) must still yield a deterministic report —
  // never a raw error string in the user's stream. runDeepResearch itself never throws
  // (the engine guarantees a report), so this try guards the pre-graph assembly.
  // M1: the soft DR concurrency cap short-circuits via a sentinel into the same finalize.
  let result;
  let sovereign = null;
  // Pre-graph model spend (clarify + plan decision) — merged into result.usage after the
  // run for EVERY outcome, so billing covers each call.
  let clarifyUsage = null;
  let planUsage = null;
  /**
   * The same three calls' tokens, by model. They ride ALONGSIDE `result.usage`, never
   * instead of it: `buildDeepResearchCollectedUsage` reconciles the split against the
   * aggregate, so a call folded into one and not the other would make every run with a
   * clarify, plan or title step fall back to lead-rate billing — silently undoing the split.
   */
  let clarifyUsageByModel = null;
  let planUsageByModel = null;
  // The classified turn (task #21) — declared out here so the finalize tail can use
  // `turn.originalRequest` for the title fallback (the raw request, not a START marker).
  let turn = { kind: 'fresh', dialogue: null, originalRequest: text ?? '', parentText: '' };
  const otherActiveJobs = await countOtherActiveJobs({
    streamId,
    userId,
    tenantId: req?.user?.tenantId,
  });
  // Computed lazily below (only when past turn classification and under the per-user cap),
  // so a plan-cancel or a user already at their own cap never pays for the global scan.
  // Kept in this scope so the catch tail can report the count it refused on.
  let otherActiveDrJobs = 0;
  try {
    /**
     * Every research node needs a non-reasoning model. `resolveDeepResearchModel`
     * returns undefined (never a reasoning model) when a mode is misconfigured with
     * only reasoning candidates, which would otherwise build a model with an empty
     * slug and fail opaquely mid-run. Resolve all four slugs once and refuse up
     * front — the catch below turns this into a clear, deterministic message
     * instead of an internal-error banner. In the normal (correctly-configured)
     * case every slug resolves, so this guard is a no-op.
     */
    const workerModelSlug = workerModelFor(tier, conversationModel);
    const reportModelSlug = reportModelFor(tier, conversationModel);
    const compressModelSlug = compressModelFor(tier, conversationModel);
    if (!leadModelSlug || !workerModelSlug || !reportModelSlug || !compressModelSlug) {
      throw new DeepResearchConfigError(leadModelSlug ?? workerModelSlug);
    }

    // Task #21 plan gate + D2 clarify: classify the turn and assemble the research input.
    // Review r2: classification is UNCONDITIONAL (flag-independent) — buildDrTurnContext
    // recognises plan/clarify parents via the persisted drKind, so START/CANCEL on an
    // existing plan card keep working even after a planGate rollback (before, a rollback
    // made the runner research the literal '▶ Начать исследование' marker as the topic).
    // The flags below only control which NEW gate turns are emitted. Fail-open: a parent-
    // load failure → the raw request (a fresh turn). `researchInput` is what gets masked.
    const clarifyEnabled = req.config?.deepResearch?.clarify !== false;
    const planGateEnabled = req.config?.deepResearch?.planGate === true;
    turn =
      precomputedTurn ??
      (await buildDrTurnContext({
        userId,
        conversationId,
        parentMessageId,
        text,
        currentUserMessageId: requestMessage?.messageId,
      }));
    const researchInput = turn.dialogue ?? text ?? '';

    // Diagnostic (task #21): the turn classification + input SHAPE, so a "plan didn't
    // change after my comment" report can be traced to fresh-vs-plan-edit straight from the
    // logs (the gap that made the original bug hard to see). Content is NOT logged — at this
    // point researchInput is the RAW pre-mask user text and may carry PII; kind + whether a
    // dialogue was assembled + its size already tell fresh (comment alone) from plan-edit
    // (full [original + plan + comment]) apart.
    logger.info(
      `[deepResearchRun] turn kind=${turn.kind} dialogue=${turn.dialogue ? 'yes' : 'no'} ` +
        `inputChars=${researchInput.length}`,
    );

    // The concurrency caps run AFTER turn classification but skip the model-free terminal
    // turns handled just below — a plan-cancel and a duplicate START run no graph, so a cap
    // would only swap their own terminal message (dismiss / "already running") for a busy
    // notice and, for the global arm, waste a store scan. A cancel especially must always
    // succeed, or the plan stays the branch tip and follow-ups keep routing into DR. The
    // per-user cap is checked first (its message is the more actionable one); only a start
    // that clears it pays for the global scan.
    //
    // They also run BEFORE the admission stamp below, and that order is the fix for a dead
    // end: a refused start used to be stamped drKind='start' and saved first, so the plan
    // card lost its action buttons and the user's retry was classified as a duplicate START
    // and answered "already running, wait for the report" — for a run that was refused and
    // never existed. A run that is not admitted must leave no trace that it was.
    const isModelFreeTerminal =
      turn.kind === 'plan-cancel' || (turn.kind === 'plan-start' && turn.duplicateStart === true);
    if (!isModelFreeTerminal) {
      if (otherActiveJobs >= MAX_CONCURRENT_DR) {
        throw new DeepResearchCapError('user');
      }
      otherActiveDrJobs = await countOtherActiveDrJobs(streamId);
      if (otherActiveDrJobs >= MAX_GLOBAL_DR) {
        throw new DeepResearchCapError('global');
      }
    }

    // Provenance + admission persistence (review r2): stamp drKind on the user's command
    // messages and persist the question NOW — the finalize-tail save (an upsert on the
    // same messageId) merely refreshes it. Early persistence is what makes a duplicate
    // START from another tab detectable, and the question survives a deploy mid-run.
    if (requestMessage) {
      if (turn.kind === 'plan-start') {
        requestMessage.drKind = 'start';
      } else if (turn.kind === 'plan-cancel') {
        requestMessage.drKind = 'cancel';
      }
      await saveMessage(reqCtx, requestMessage, {
        context: 'deepResearchRun - user message (admission)',
      });
    }

    // Model-free short-circuits (review r2) — resolved BEFORE the anonymizer session, so a
    // cancel or a duplicate START costs zero anonymizer/model round-trips. A duplicate
    // START (a second tab already launched this plan, or a re-click after completion) is
    // refused with a terminal message instead of silently running the same research twice.
    if (turn.kind === 'plan-start' && turn.duplicateStart === true) {
      logger.warn(`[deepResearchRun] duplicate START for conversation ${conversationId}; refusing`);
      result = {
        finalReport: DUPLICATE_START_MESSAGE,
        finalizeReason: 'limit',
        usage: { input: 0, output: 0, total: 0 },
        findings: [],
      };
    } else if (turn.kind === 'plan-cancel') {
      // The user dismissed the plan card: a terminal, non-error message with NO DR marker
      // or drKind, so the NEXT user message routes to normal chat (closes the routing
      // hole). Zero model calls.
      result = {
        finalReport: CANCELLED_MESSAGE,
        finalizeReason: 'cancelled',
        usage: { input: 0, output: 0, total: 0 },
        findings: [],
      };
    }

    if (result == null) {
      // Track B (sovereign DR): mask the user's question ONCE, then run the graph in
      // anonymizer passthrough so ONLY user data (question + documents) is masked — never
      // the public web. Best-effort: any failure leaves `sovereign` null and DR runs the
      // legacy full-masking path (anonymizer masks all egress), which is safe — it just
      // over-masks public content.
      let connection = null;
      try {
        connection = await resolveAnonymizerConnection({
          req,
          db,
          endpoint,
          model: leadModelSlug,
        });
      } catch (error) {
        logger.warn(
          '[deepResearchRun] anonymizer connection unresolved; sovereign masking off',
          error,
        );
      }
      sovereign = await startSovereignSession({
        connection,
        runId,
        userId,
        passthroughToken: process.env.ANON_PASSTHROUGH_TOKEN || '',
        question: researchInput,
        signal,
        logger,
      });
      passthroughHeaders = sovereign?.passthroughHeaders ?? null;
    }

    // Pre-graph decision. Either sets `result` (a terminal turn — questions or a plan
    // card — that flows through the SAME finalize tail below: restore de-masks, save,
    // title, final event) or leaves it null so the graph runs on `researchInput`. Runs
    // on the MASKED input. A user Stop during the decision (ABORTED) exits without a
    // response — stopping the gate must not fabricate a "partial report" for research
    // that never ran.
    const decisionInput = sovereign ? sovereign.maskedQuestion : researchInput;
    if (result == null && planGateEnabled && turn.kind !== 'plan-start') {
      // fresh | clarify-answer | plan-edit → run the unified decision. Never ask questions
      // twice: allowClarify only on a fresh, clarify-enabled turn.
      emitDrPhase('plan');
      const decision = await runPlanDecision({
        buildModel,
        leadModelSlug,
        input: decisionInput,
        now: new Date().toISOString(),
        signal,
        allowClarify: clarifyEnabled && turn.kind === 'fresh',
        // A comment on an existing plan (card edit or post-Stop) → tell the model to return
        // an UPDATED plan that reflects the change, not a near-identical one (task #21).
        isRefinement: turn.kind === 'plan-edit',
      });
      planUsage = decision.usage;
      planUsageByModel = decision.usageByModel;
      if (decision.action === 'ABORTED') {
        logger.info('[deepResearchRun] stopped during the plan decision; saving a STOPPED anchor');
        result = STOPPED_RESULT();
      }
      logger.info(
        `[deepResearchRun] plan decision: ${decision.action}` +
          (decision.action === 'CLARIFY' ? ` (${decision.questions.length} questions)` : '') +
          (decision.action === 'PLAN' ? ` (${decision.steps.length} steps)` : ''),
      );
      if (decision.action === 'CLARIFY') {
        result = {
          finalReport: formatClarifyMessage(decision.questions),
          finalizeReason: 'clarify',
          usage: { input: 0, output: 0, total: 0 },
          findings: [],
        };
      } else if (decision.action === 'PLAN') {
        const planTitle = decision.title || buildDeepResearchTitle(turn.originalRequest || text);
        const planSteps = decision.steps.length > 0 ? decision.steps : FALLBACK_PLAN_STEPS;
        result = {
          finalReport: formatPlanMessage({ title: planTitle, steps: planSteps }),
          finalizeReason: 'plan',
          usage: { input: 0, output: 0, total: 0 },
          findings: [],
        };
      }
      // PROCEED → result stays null → the graph runs below on `researchInput`.
    } else if (result == null && !planGateEnabled && clarifyEnabled && turn.kind === 'fresh') {
      // Shipped clarify path (unchanged): under-specified turn-1 → ask up to 3 questions.
      const decision = await runClarifyCheck({
        buildModel,
        leadModelSlug,
        question: decisionInput,
        now: new Date().toISOString(),
        signal,
      });
      clarifyUsage = decision.usage;
      clarifyUsageByModel = decision.usageByModel;
      if (decision.action === 'ABORTED') {
        logger.info('[deepResearchRun] stopped during the clarify check; saving a STOPPED anchor');
        result = STOPPED_RESULT();
      }
      logger.info(
        `[deepResearchRun] clarify decision: ${decision.action}` +
          (decision.questions.length ? ` (${decision.questions.length} questions)` : ''),
      );
      if (decision.action === 'CLARIFY') {
        result = {
          finalReport: formatClarifyMessage(decision.questions),
          finalizeReason: 'clarify',
          usage: { input: 0, output: 0, total: 0 },
          findings: [],
        };
      }
    }
    // plan-start (plan gate on) falls through with result === null → the graph runs on the
    // approved dialogue (`researchInput`).

    // Skip the (expensive) graph build + run when the decision already produced the turn's message.
    if (!result) {
      // In passthrough the anonymizer won't mask file_search output, so we mask the user's document
      // text ourselves. If masking fails we drop the chunk (never egress raw PII), not the whole run.
      const maskFileSearch = sovereign
        ? async (content) => {
            try {
              return await sovereign.maskContent(content);
            } catch (error) {
              logger.warn(
                '[deepResearchRun] file_search masking failed; dropping chunk from context',
                error,
              );
              return 'Результаты поиска по документам недоступны (не удалось безопасно обезличить).';
            }
          }
        : undefined;

      const [leadModel, workerModel, compressModel, reportModel] = await Promise.all([
        buildModel(leadModelSlug),
        buildModel(workerModelSlug),
        buildModel(compressModelSlug),
        buildModel(reportModelSlug),
      ]);

      const [fileSearchTool, webSearchTool] = await Promise.all([
        buildChatFileSearchTool({ req, userId, conversationId, transformContent: maskFileSearch }),
        buildWebSearchTool({ req, userId }),
      ]);
      const tools = [fileSearchTool, webSearchTool].filter(Boolean);
      /**
       * Which models this run ACTUALLY resolved, and where their calls are routed.
       *
       * Nothing logged this before, and the gap cost a live investigation: a tier's
       * `leadModel` in librechat.yaml is only the SEED — the live value is the admin
       * override in the config collection (see packages/api/src/admin/deepResearch.ts),
       * and the two silently diverge. A yaml edit that looks deployed — the file is
       * right inside the container — can therefore change nothing, and the only way to
       * find out was to read the billing rows afterwards and see which model was
       * charged. One line here answers it while the run is still going.
       *
       * The provider pin is on the same line for the same reason: it decides which
       * platform serves the call, platforms differ in price and quantisation, and it
       * is otherwise invisible outside the OpenRouter response we do not log.
       */
      const pin = tier.provider;
      logger.info(
        `[deepResearchRun] models: lead=${leadModelSlug} worker=${workerModelSlug} ` +
          `compress=${compressModelSlug} report=${reportModelSlug} · providers=` +
          (pin
            ? `${pin.order.join('>')}${pin.allow_fallbacks === false ? ' (strict)' : ' (soft)'}`
            : 'unpinned'),
      );
      // The single most diagnostic line for a "gathered nothing" run: researchers
      // without web_search can only produce empty findings (→ nodata).
      logger.info(
        `[deepResearchRun] tools: web_search=${webSearchTool ? 'on' : 'OFF'} file_search=${fileSearchTool ? 'on' : 'off'}`,
      );
      if (!webSearchTool) {
        logger.warn(
          '[deepResearchRun] web_search tool unavailable (check webSearch auth/keys) — the run will likely produce no material',
        );
      }

      const graph = createDeepResearchGraph({
        leadModel,
        workerModel,
        compressModel,
        reportModel,
        tools,
        tier,
        now: new Date().toISOString(),
        // Per-run spotlighting nonce: fences untrusted web/RAG/tool material so injected
        // page content cannot escape the data fences into instruction space (H5).
        nonce: randomUUID(),
      });

      // Task #21 live progress: translate the engine's coarse onProgress into `dr_progress`
      // snapshots the frontend plan card renders (steps checklist + current action + bar).
      // Progress is proportional (computed here — no graph changes). Steps come from the
      // approved plan message. Gated on the plan gate + streamId; fire-and-forget so a slow
      // emit never blocks the run, and it always ALSO logs (the shipped ops line).
      const planSteps =
        planGateEnabled && isPlanMessage(turn.parentText) ? extractPlanSteps(turn.parentText) : [];
      const maxRounds = Math.max(1, tier.maxOrchestratorCycles || 6);
      let searchCount = 0;
      /**
       * Which plan step the card highlights, 0-based — and the reason this is a
       * variable here rather than arithmetic in the client.
       *
       * The card used to derive it from the progress fraction: `floor(0.40 × 5)`
       * put a five-step plan on step 3 at the FIRST research round, so step 1 was
       * never once shown as running and two steps were already ticked off, while
       * the action line under them described a sub-question that belongs to no
       * step at all (owner r27). The fraction encodes supervisor rounds, and the
       * relation between rounds and plan steps does not exist — the supervisor
       * now says which step its batch advances and that answer travels here.
       *
       * Monotonic on purpose: a checklist reads as progress, so a step that has
       * gone back would UN-TICK finished work. Held server-side so a reload, a
       * replay and a second tab all agree. It starts on the first step — SCOPE
       * is the run working toward it — and marks nothing done until a later
       * step is actually reported.
       */
      let planStepIndex = 0;
      /**
       * One `dr_progress` snapshot. The client REPLACES its snapshot wholesale
       * (`setDrProgress` in useResumableSSE), so every emit has to carry the checklist and
       * the search count too — a partial one would blank the card's steps.
       */
      const emitDrProgress = (phase, action, progress) => {
        if (!streamId || !planGateEnabled) {
          return;
        }
        Promise.resolve(
          GenerationJobManager.emitChunk(streamId, {
            event: 'dr_progress',
            data: {
              phase,
              steps: planSteps,
              action,
              searches: searchCount,
              progress,
              stepIndex: planSteps.length > 0 ? planStepIndex : undefined,
            },
          }),
        ).catch(() => {});
      };
      /**
       * Report-phase heartbeat. The engine announces the phase from the supervisor's
       * concluding pass — the only moment it can, since REPORT itself says nothing until
       * it is finished — and from there a timer keeps the card honest for the minutes the
       * model spends writing.
       *
       * Nothing of the report's own text travels this channel, and that is a rule rather
       * than an omission: in sovereign mode the model writes on MASKED material and the
       * text is de-masked exactly once, at the end (`sovereign.restore`), with the
       * substitution map held inside the anonymizer and not in this process. A chunk
       * forwarded from here could not be de-masked at all — it would put `[[PERSON_1]]`
       * on screen in the report's own title, the one place a report echoes the question,
       * and then swap it for the real name when the run finalizes.
       */
      let reportStartedMs = 0;
      let reportTicker = null;
      const emitReportProgress = () => {
        const elapsedMs = reportStartedMs > 0 ? Date.now() - reportStartedMs : 0;
        emitDrProgress('report', drReportAction(elapsedMs), drReportFraction(elapsedMs));
      };
      const stopReportTicker = () => {
        if (reportTicker != null) {
          clearInterval(reportTicker);
          reportTicker = null;
        }
      };

      const onProgress = (event) => {
        // The sub-question is NOT logged. From round 1 on it is written by the supervisor
        // after reading digests of untrusted pages, and on the legacy (non-sovereign) path
        // model output arrives already de-masked — so the text can carry page-derived
        // content or the user's own personal data straight into the stand's docker logs.
        // Length only, the same discipline the engine already keeps in its own nodes.
        logger.info(
          `[deepResearchRun] ${event.type}` +
            `${event.subQuestion ? ` (sub-question ${event.subQuestion.length} chars)` : ''}`,
        );
        if (event.type === 'report') {
          /* Fired twice by design: once when the supervisor concludes (the phase STARTS)
           * and once when the report node returns (it is over). The first arrival starts
           * the clock and the heartbeat; the second is just the last tick before the
           * final, and must not restart anything. */
          /* Writing the report IS the plan's last step — the gathering is over,
           * so everything before it has genuinely happened. This is also the
           * only honest way to close a plan whose middle steps the supervisor
           * never named. */
          if (planSteps.length > 0) {
            planStepIndex = planSteps.length - 1;
          }
          if (reportStartedMs === 0) {
            reportStartedMs = Date.now();
            /* No card listening (legacy gate-off run) → no heartbeat. `emitDrProgress`
             * would swallow every tick anyway; a timer whose only job is to be ignored
             * for four minutes is not worth arming. */
            if (streamId && planGateEnabled) {
              reportTicker = setInterval(emitReportProgress, REPORT_TICK_MS);
              reportTicker.unref?.();
            }
          }
          emitReportProgress();
          return;
        }
        if (event.type === 'research') {
          searchCount += 1;
          /* The supervisor's own answer, never below where the card already is
           * (see `planStepIndex`). A round it did not label leaves the
           * highlight where it stands rather than moving it somewhere made up. */
          if (event.planStep > 0 && event.planStep <= planSteps.length) {
            planStepIndex = Math.max(planStepIndex, event.planStep - 1);
          }
        }
        emitDrProgress(
          event.type,
          drProgressAction(event),
          drProgressFraction(event, maxRounds, searchCount),
        );
      };

      try {
        result = await runDeepResearch({
          graph,
          // Track B: the graph sees the MASKED question (sovereign) or the raw text (legacy).
          input: {
            messages: [new HumanMessage(sovereign ? sovereign.maskedQuestion : researchInput)],
          },
          configurable: {
            runId,
            userId,
            conversationId,
            mode: tier.name,
            budget: tierToRunBudget(tier),
            /* The plan the user approved (and may have edited). Until r27 the
             * graph never saw it: the run was steered only by the brief, so a
             * plan the user had corrected changed nothing about the research.
             * Empty for a PROCEED run, which keeps that path's prompts exactly
             * as they were measured. */
            planSteps,
          },
          signal,
          wallClockMs: Math.max(1, tier.wallClockMinutes) * 60_000,
          onProgress,
        });
      } finally {
        /* The heartbeat must not outlive the run on ANY path — including the abort that
         * unwinds through here — or it keeps emitting into a stream the client has
         * already finalized. */
        stopReportTicker();
      }
    }
  } catch (error) {
    if (error instanceof DeepResearchConfigError) {
      logger.error(
        '[deepResearchRun] Deep Research mode is misconfigured (no non-reasoning model for a research step); refusing the run',
        error,
      );
      result = {
        finalReport:
          'Глубокое исследование сейчас недоступно из-за настроек: для шага исследования не задана подходящая модель. Обратитесь к администратору.',
        finalizeReason: 'error',
        usage: { input: 0, output: 0, total: 0 },
        findings: [],
      };
    } else if (error instanceof DeepResearchCapError) {
      const isGlobal = error.scope === 'global';
      logger.warn(
        isGlobal
          ? `[deepResearchRun] global DR cap reached (${otherActiveDrJobs} active, max ${MAX_GLOBAL_DR}); rejecting user ${userId}`
          : `[deepResearchRun] user ${userId} at DR concurrency cap (${otherActiveJobs} active); rejecting`,
      );
      result = {
        finalReport: isGlobal
          ? 'Сейчас одновременно выполняется много исследований — сервис загружен. Пожалуйста, запустите это исследование через несколько минут.'
          : 'У вас уже выполняется несколько задач одновременно. Дождитесь завершения текущих исследований и запустите это снова.',
        finalizeReason: 'limit',
        usage: { input: 0, output: 0, total: 0 },
        findings: [],
      };
    } else {
      logger.error('[deepResearchRun] failed to assemble or run DR; using fallback report', error);
      result = {
        finalReport: buildFallbackReport({ reason: sanitizeErrorForUser(error) }),
        finalizeReason: 'error',
        usage: { input: 0, output: 0, total: 0 },
        findings: [],
      };
    }
  }

  // The clarify/plan decision is a real lead-model call — bill it on EVERY outcome (the
  // short-circuits carry zero usage of their own; the PROCEED path's graph usage is separate).
  if (clarifyUsage) {
    result.usage = sumUsage(result.usage, clarifyUsage);
    result.usageByModel = mergeUsageByModel(result.usageByModel ?? {}, clarifyUsageByModel ?? {});
  }
  if (planUsage) {
    result.usage = sumUsage(result.usage, planUsage);
    result.usageByModel = mergeUsageByModel(result.usageByModel ?? {}, planUsageByModel ?? {});
  }

  // Ops summary: one line telling exactly HOW the run ended and how much material it
  // gathered, plus every non-fatal node error — a degraded run (dead search, failing
  // model) must be visible in logs, never silent.
  logger.info(
    `[deepResearchRun] finalized reason=${result.finalizeReason} findings=${result.findings.length} ` +
      `errors=${result.errors?.length ?? 0} tokens=${result.usage?.total ?? 0}`,
  );
  for (const nodeError of result.errors ?? []) {
    logger.warn(`[deepResearchRun] node error [${nodeError.node}]: ${nodeError.message}`);
  }

  // `unfinished` is now a MACHINE record, not a message to anybody: nothing renders it for a
  // Deep Research report on any surface (owner decision, 27.08.2026 — a report written from
  // less material is still a real synthesis, and a self-deprecating line under it reads to a
  // client as an unreliable platform rather than as candour). It is still written, because
  // it is how a truncated run is counted afterwards — `tools/dr_run_metrics/snapshot.py`
  // reads it straight off `db.messages` — and the ops line above still names the reason.
  //
  // The ALLOW-list stays narrow for the same reason it was narrow before: the flag has to
  // mean "the model wrote a real report but gathering stopped at its gate" and nothing else,
  // or the count it feeds stops meaning anything. Every other outcome saves a COMPLETE,
  // self-contained message: a full report ('completed'), a plan/clarify card, a concurrency
  // refusal ('limit'), a dismissed plan ('cancelled'), a clean STOPPED notice ('aborted'), or
  // an honest failure notice with nothing above it ('time'/'error'/'nodata').
  //
  // A user Stop (aborted) ALWAYS saves a clean STOPPED notice and NEVER a report — owner
  // decision (2026-07-13): Stop = "I don't want this", so no partial, no findings dump,
  // regardless of how much was gathered.
  const abortedStop = result.finalizeReason === 'aborted';
  const unfinished = TRUNCATED_REASONS.has(result.finalizeReason);
  // Track B: de-mask the final report via the server-side run map (placeholders → real PII), then
  // free the map. restore never throws (worst case: placeholders remain — safe, not a leak); both
  // run for EVERY outcome incl. abort, so the partial report saved below is de-masked too.
  let reportText = result.finalReport;
  if (sovereign) {
    reportText = await sovereign.restore(result.finalReport);
    await sovereign.drop();
  }

  // P6+: chat title = a model-distilled TOPIC of the (masked) request — robust to any
  // phrasing and PII-free (it runs on the masked question). Review r2 (title-once): the
  // model call runs ONCE per conversation — the first gate turn names the chat; every
  // later turn (start/edit/report) reuses the persisted row's title, which also respects
  // a user's manual rename. Before, EVERY plan-gate turn burned a title LLM call
  // (clarify → plan → start = 3 calls, +1-3s latency apiece). An aborted OR cancelled
  // run also skips the call. The fallback is the ORIGINAL request (task #21), not a
  // turn-2 command marker. The row loaded here is reused by the M9/M10 block below.
  const titleFallbackText = turn.originalRequest || text;
  let existingConvo = null;
  try {
    existingConvo = await getConvo(userId, conversationId);
  } catch (error) {
    logger.warn('[deepResearchRun] failed to load conversation for title reuse', error);
  }
  const existingTitle =
    typeof existingConvo?.title === 'string' &&
    existingConvo.title.trim() !== '' &&
    existingConvo.title !== DEFAULT_CONVO_TITLE
      ? existingConvo.title
      : null;
  const skipModelTitle =
    existingTitle != null ||
    result.finalizeReason === 'aborted' ||
    result.finalizeReason === 'cancelled';
  const {
    title: deepResearchTitle,
    usage: titleUsage,
    usageByModel: titleUsageByModel,
  } = skipModelTitle
    ? {
        title: existingTitle ?? buildDeepResearchTitle(titleFallbackText),
        usage: null,
        usageByModel: {},
      }
    : await resolveDeepResearchTitle({
        req,
        endpoint,
        buildModel: buildTitleModel,
        leadModelSlug,
        topicText: sovereign ? sovereign.maskedQuestion : titleFallbackText,
        fallbackText: titleFallbackText,
        signal,
      });
  // The title is a real lead-model call too — include it before the usage is billed below.
  if (titleUsage) {
    result.usage = sumUsage(result.usage, titleUsage);
    result.usageByModel = mergeUsageByModel(result.usageByModel ?? {}, titleUsageByModel ?? {});
  }

  // Parity with the standard title pipeline (answers the gen_title 404): the frontend
  // eagerly polls GET /api/convos/gen_title/:conversationId (retrying 404s) for every
  // new conversation — populate the SAME cache the standard addTitle service fills, and
  // emit the same live 'title' SSE event, so DR titles behave exactly like normal chats.
  if (!skipModelTitle && !req?.body?.isTemporary) {
    try {
      const titleCache = getLogStores(CacheKeys.GEN_TITLE);
      await titleCache.set(`${userId}-${conversationId}`, deepResearchTitle, 120000);
    } catch (error) {
      logger.warn('[deepResearchRun] failed to cache title for gen_title route', error);
    }
    if (streamId) {
      try {
        await GenerationJobManager.emitChunk(streamId, {
          event: 'title',
          data: { conversationId, title: deepResearchTitle },
        });
      } catch (error) {
        logger.warn('[deepResearchRun] failed to emit title event', error);
      }
    }
  }

  // A Stop ALWAYS renders the clean STOPPED notice (owner decision) — never a report, even
  // if findings were gathered; it also stays a followable drKind='aborted' anchor for the
  // plan re-edit (task #21). Every OTHER outcome saves its text verbatim: with the graph's
  // synthesis reserve (Ф6a) a budget/rounds/time-limited run is a REAL model report, not a
  // partial — no "Частичный отчёт" banner (PR-2); a genuine failure already carries the
  // honest 'error'/'nodata' notice from the report node.
  const finalReportText = abortedStop ? STOPPED_MESSAGE : reportText;
  const responseMessage = {
    messageId: responseMessageId,
    conversationId,
    // H2: the report's parent is the user's QUESTION, not the question's parent.
    // Otherwise the report and the question become siblings and `buildTree` drops
    // the report on refetch (it vanishes on reload). Mirrors GenerationJobManager.
    parentMessageId: requestMessage?.messageId ?? parentMessageId,
    sender: sender ?? 'Deep Research',
    isCreatedByUser: false,
    user: userId,
    endpoint,
    model: leadModelSlug,
    text: finalReportText,
    content: [{ type: 'text', text: finalReportText }],
    unfinished,
    error: false,
  };
  // Provenance (review r2): the client mounts the plan card / report card on this field.
  const responseDrKind = drKindForReason(result.finalizeReason);
  if (responseDrKind) {
    responseMessage.drKind = responseDrKind;
  }

  // D4: attach the report as a downloadable PDF chip on the response message — BEFORE it is
  // saved, so the persisted message carries the file. Fail-open; skips temp/non-report runs.
  await attachReportPdf({
    req,
    responseMessage,
    reportMarkdown: finalReportText,
    title: deepResearchTitle,
    finalizeReason: result.finalizeReason,
  });

  // Save user + response BEFORE the final event (mirrors request.js:523-546 — avoids
  // the race where a follow-up arrives before the response is persisted). The user
  // message was saved at admission for a run that was ADMITTED, and this upsert refreshes
  // it; for a run refused by a cap the admission save never happened, so this is its first
  // and only write — which is the point: a refused run leaves no 'start' provenance, so the
  // retry the refusal message asks for is not mistaken for a duplicate START. It does still
  // become a CHILD of the plan message, so the plan card's own buttons go inert either way;
  // the user retypes the request rather than clicking «Начать». The response
  // is saved for EVERY outcome, including a Stop that collected nothing: the frontend
  // already threads the next message onto this responseMessageId (from the abort final
  // event), so it must exist in the DB (drKind='aborted') or the follow-up dangles on a
  // missing parent and falls through to a fresh turn (the task #21 re-plan bug).
  if (requestMessage) {
    await saveMessage(reqCtx, requestMessage, { context: 'deepResearchRun - user message' });
  }
  const savedResponse = await saveMessage(reqCtx, responseMessage, {
    context: 'deepResearchRun - final report',
  });

  /**
   * The live final MUST carry the persisted timestamps, or the message the client shows now
   * differs from the one it refetches later — and the chat reads that difference as "the
   * assistant is still mid-stream". `responseMessageId` is `<userMessageId>_` (the
   * preliminary id from request.js), and a trailing-underscore assistant message with no
   * `createdAt` is exactly `hasPendingAssistantParent`'s signature (client
   * useChatFunctions.ts:75-81): while it is the conversation tip, `ask` refuses EVERY
   * submit — composer silently, plan card with a toast. Only a reload cleared it, because
   * Mongo hands the same message back stamped.
   *
   * Ordinary chats are safe for a different reason than this fix — do not read one into the
   * other: their finals are equally timestamp-less, but their response id is a fresh UUID
   * (BaseClient.js:218), so they fail the `endsWith('_')` clause first. This run is the only
   * path that puts a preliminary id in a final, which is why it is the only one that has to
   * stamp it. Keeping that `_` id is deliberate — the next turn threads onto it
   * (`getAppendParentMessageId`) — so the timestamps are what must give.
   *
   * Only they are lifted across; `_id`/`__v` are Mongo's business. `saveMessage` answers
   * with nothing only when it never wrote (invalid conversation id) or when its
   * duplicate-key fallback cannot re-read the row — both leave the object as it was, which
   * is the pre-existing behaviour, never a crash. Must stay ABOVE the emit: `emitDone`
   * serialises the event for late and cross-replica subscribers, so stamping afterwards
   * would still ship them an unstamped final.
   */
  if (savedResponse?.createdAt) {
    responseMessage.createdAt = savedResponse.createdAt;
    responseMessage.updatedAt = savedResponse.updatedAt ?? savedResponse.createdAt;
  }

  // H4: bill the run's token usage (every outcome consumed tokens, including a Stop),
  // so Transactions/balance/spend-limits apply to DR. Runs before the abort early-return.
  await billDeepResearchUsage({
    userId,
    conversationId,
    messageId: responseMessageId,
    model: leadModelSlug,
    usage: result.usage,
    usageByModel: result.usageByModel,
    endpointTokenConfig: await resolveEndpointPricing({
      req,
      db,
      endpoint,
      model: leadModelSlug,
    }),
  });

  // A user Stop finalizes through here like every other outcome. It used to return early,
  // leaving the /abort route's synthetic final to speak for us — but that final carries the
  // job's buffered content, which for DR is EMPTY, so the client showed nothing and only a
  // reload revealed the persisted "исследование остановлено" notice (and its drKind anchor,
  // without which the plan-edit follow-up never rendered). `producerFinalizesOnAbort` (set at
  // the top of this run) makes abort signal-only, so emitting here is the ONLY final, not a
  // double one.

  // M9/M10: a NEW DR chat has no persisted Conversation row yet, so the sidebar would
  // show nothing until reload and the final event would carry an empty conversation.
  // Persist the row (with a deterministic title, never "New Chat") and build the final
  // object from it. A persistence hiccup degrades to a minimal object, never a failed run.
  // The row was already loaded once for the title-once check above — reused here.
  let conversation = existingConvo;
  try {
    if (!conversation) {
      const saved = await saveConvo(
        reqCtx,
        {
          conversationId,
          endpoint,
          /** The endpoint's PARAM FAMILY, saved beside the endpoint itself because the two
           *  are read as a pair. A custom endpoint's name is not a schema key, so anything
           *  that parses a conversation's settings resolves it through `endpointType` — with
           *  the field missing, `parseConvo` throws `Unknown endpoint: <name>` and the caller
           *  dies. That is what broke Export: json/txt/markdown build an options block from
           *  the parsed conversation and every DR chat threw there, while csv and screenshot
           *  (which build no options) worked — measured on the stand, 42 of 42 conversations
           *  missing this field were DR ones, 0 of 128 others. The normal path persists it
           *  from client options (`getSaveOptions`); a DR run bypasses AgentClient, so it
           *  must carry the same pair itself. Third field of this exact omission after the
           *  model card and the project link below. */
          ...(endpointType ? { endpointType } : {}),
          model: leadModelSlug,
          title: deepResearchTitle,
          /** The chat's model card. DR persisted four fields and not this one, so a chat
           *  STARTED by a research run had no spec at all — and continuing it as an ordinary
           *  chat afterwards silently lost the card's own routing (its provider pin and
           *  fallback list) for every later turn. */
          ...(req?.body?.spec ? { spec: req.body.spec } : {}),
          /** A DR run bypasses AgentClient, so it also bypasses the getSaveOptions hop that
           *  files a chat under its Project — without this, research started inside a project
           *  lands outside it and stays outside after a reload. */
          ...(req?.body?.project_id ? { project_id: req.body.project_id } : {}),
        },
        { context: 'deepResearchRun - persist new conversation' },
      );
      conversation = saved && saved.conversationId ? saved : null;
    }
  } catch (error) {
    logger.warn(
      '[deepResearchRun] failed to load/persist conversation; using minimal object',
      error,
    );
  }
  const finalConversation = conversation
    ? { ...conversation, conversationId }
    : { conversationId, endpoint, model: leadModelSlug, title: deepResearchTitle };

  const finalEvent = {
    final: true,
    conversation: finalConversation,
    title: finalConversation.title,
    requestMessage: requestMessage ? sanitizeMessageForTransmit(requestMessage) : undefined,
    responseMessage,
  };

  if (streamId) {
    // Parity with the standard path's stale-job guard (review r2): if ANOTHER submission
    // replaced this job mid-run (e.g. a normal message sent from a second tab during the
    // research), the replacement owns the stream now — emitting done/completeJob here
    // would inject a stale final into its subscribers and ABORT its run. The report
    // itself is already persisted above, so nothing is lost.
    const currentJob = await GenerationJobManager.getJob(streamId);
    const jobWasReplaced =
      !currentJob || (jobCreatedAt != null && currentJob.createdAt !== jobCreatedAt);
    if (jobWasReplaced) {
      logger.warn(
        `[deepResearchRun] job ${streamId} was replaced mid-run; skipping the final emit`,
      );
    } else {
      await GenerationJobManager.emitDone(streamId, finalEvent);
      GenerationJobManager.completeJob(streamId);
    }
  } else {
    sendEvent(res, finalEvent);
    res.end();
  }

  return result;
}

module.exports = {
  runNewDeepResearch,
  /** Test-only exports: the wrapper that makes a tool's RETURNED failure a real failure, and
   *  the sentences it matches — which live in another file and can drift out from under it. */
  failOnToolReportedError,
  FILE_SEARCH_FAILURE_MARKERS,
  buildDeepResearchTitle,
  isDrFollowUp,
  buildDrTurnContext,
  buildDeepResearchCollectedUsage,
  /** Test-only: the live card's progress curves. */
  drProgressFraction,
  drReportFraction,
  drReportAction,
};
