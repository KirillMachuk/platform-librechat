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

/** Anonymizer PII placeholders (PERSON_1, PHONE_2, EMAIL_1…) that must never surface in a title. */
const TITLE_PII_PLACEHOLDER = /\b[A-ZА-Я][A-ZА-Я]{2,}_\d+\b/g;

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
    return { title: buildDeepResearchTitle(fallbackText), usage: null };
  }
  try {
    const titleConfig = resolveTitleConfig(req, endpoint);
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
    };
  } catch (error) {
    logger.warn('[deepResearchRun] title generation failed; using heuristic fallback', error);
    return { title: buildDeepResearchTitle(fallbackText), usage: null };
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
 *  — the only case where the frontend's "may be incomplete … results above are still usable"
 *  indicator tells the truth. Every other outcome is a COMPLETE message (a full report, a
 *  plan, a Stop, or an honest failure notice with nothing above it), so it must not carry an
 *  indicator promising usable results (PR-2: no partial reports → no partial indicator). */
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

/** Coarse 0..1 progress for the live card (task #21) from a graph progress event. */
function drProgressFraction(event, maxRounds, searchCount) {
  if (event.type === 'scope') {
    return 0.08;
  }
  if (event.type === 'report') {
    return 0.92;
  }
  return 0.1 + 0.75 * Math.min((event.round || searchCount) / maxRounds, 1);
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
    };
  } catch (error) {
    if (signal?.aborted) {
      return { action: 'ABORTED', questions: [], usage: null };
    }
    logger.warn('[deepResearchRun] clarify check failed; proceeding to research', error);
    return { action: 'PROCEED', questions: [], usage: null };
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
    };
  } catch (error) {
    if (signal?.aborted) {
      return { action: 'ABORTED', questions: [], title: '', steps: [], usage: null };
    }
    logger.warn('[deepResearchRun] plan decision failed; failing CLOSED to a plan card', error);
    return { action: 'PLAN', questions: [], title: '', steps: [], usage: null };
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
async function buildNodeModel({ req, db, endpoint, model, passthroughHeaders }) {
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
  const ModelClass = getChatModelClass(resolvedProvider);
  return new ModelClass({ ...clientOptions, configuration: finalConfig });
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
      (await getFiles({ file_id: { $in: convoFileIds }, embedded: true }, null, { text: 0 })) ?? [];
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
    return createFileSearchTool({ userId, files, fileCitations: true, transformContent });
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
 * Bills a completed or partial DR run (H4). The engine returns ONE aggregate usage
 * (summed across the lead/worker/compress/report models); v1 prices it under the
 * lead model — a deliberate approximation until per-model usage is tracked. DR usage
 * never enters the job's collectedUsage, so the /abort middleware bills a different
 * (empty) source and there is no double-spend. Mirrors the deps of
 * abortMiddleware.spendCollectedUsage. Failures are logged, never thrown.
 */
async function billDeepResearchUsage({ userId, conversationId, messageId, model, usage }) {
  if (!usage || usage.total <= 0) {
    return;
  }
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
        collectedUsage: [{ model, input_tokens: usage.input, output_tokens: usage.output }],
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
      pending = buildNodeModel({ req, db, endpoint, model, passthroughHeaders });
      modelCache.set(model, pending);
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

    // The concurrency caps run AFTER turn classification but skip the model-free terminal
    // turns handled just below — a plan-cancel and a duplicate START run no graph, so a cap
    // would only swap their own terminal message (dismiss / "already running") for a busy
    // notice and, for the global arm, waste a store scan. A cancel especially must always
    // succeed, or the plan stays the branch tip and follow-ups keep routing into DR. The
    // per-user cap is checked first (its message is the more actionable one); only a start
    // that clears it pays for the global scan.
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
      if (decision.action === 'ABORTED') {
        logger.info('[deepResearchRun] stopped during the plan decision; no response emitted');
        if (sovereign) {
          await sovereign.drop();
        }
        return null;
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
      if (decision.action === 'ABORTED') {
        logger.info('[deepResearchRun] stopped during the clarify check; no response emitted');
        if (sovereign) {
          await sovereign.drop();
        }
        return null;
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
      const onProgress = (event) => {
        logger.info(
          `[deepResearchRun] ${event.type}${event.subQuestion ? `: ${event.subQuestion}` : ''}`,
        );
        if (!streamId || !planGateEnabled) {
          return;
        }
        if (event.type === 'research') {
          searchCount += 1;
        }
        Promise.resolve(
          GenerationJobManager.emitChunk(streamId, {
            event: 'dr_progress',
            data: {
              phase: event.type,
              steps: planSteps,
              action: drProgressAction(event),
              searches: searchCount,
              progress: drProgressFraction(event, maxRounds, searchCount),
            },
          }),
        ).catch(() => {});
      };

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
        },
        signal,
        wallClockMs: Math.max(1, tier.wallClockMinutes) * 60_000,
        onProgress,
      });
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
  }
  if (planUsage) {
    result.usage = sumUsage(result.usage, planUsage);
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

  // The frontend "unfinished" indicator reads "…may be incomplete… Any results shown above
  // are still usable", so it may ONLY go under a message that HAS usable results above it
  // and really was cut short — i.e. budget/rounds, where the model wrote a real report but
  // gathering stopped at its gate. Every other outcome now saves a COMPLETE, self-contained
  // message: a full report ('completed'), a plan/clarify card, a concurrency refusal
  // ('limit'), a dismissed plan ('cancelled'), a clean STOPPED notice ('aborted'), or an
  // honest failure notice with nothing above it ('time'/'error'/'nodata') — putting
  // "results above are still usable" under those would be a lie. Hence an ALLOW-list: with
  // no partial reports left (PR-2), "unfinished" is the exception, not the default.
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
  const { title: deepResearchTitle, usage: titleUsage } = skipModelTitle
    ? { title: existingTitle ?? buildDeepResearchTitle(titleFallbackText), usage: null }
    : await resolveDeepResearchTitle({
        req,
        endpoint,
        buildModel,
        leadModelSlug,
        topicText: sovereign ? sovereign.maskedQuestion : titleFallbackText,
        fallbackText: titleFallbackText,
        signal,
      });
  // The title is a real lead-model call too — include it before the usage is billed below.
  if (titleUsage) {
    result.usage = sumUsage(result.usage, titleUsage);
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
  // message was already saved at admission; this upsert merely refreshes it. The response
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
        { conversationId, endpoint, model: leadModelSlug, title: deepResearchTitle },
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

module.exports = { runNewDeepResearch, buildDeepResearchTitle, isDrFollowUp, buildDrTurnContext };
