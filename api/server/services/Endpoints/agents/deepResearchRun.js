const { randomUUID } = require('node:crypto');
const { CacheKeys, Constants, FileContext } = require('librechat-data-provider');
const { HumanMessage, SystemMessage } = require('@langchain/core/messages');
const { Providers, getChatModelClass, createSearchTool } = require('@librechat/agents');
const {
  sendEvent,
  initializeCustom,
  runDeepResearch,
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
  isClarifyMessage,
  reportToPdfBuffer,
  getStorageMetadata,
  leadModelFor,
  workerModelFor,
  reportModelFor,
  compressModelFor,
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

/** Partial-report reasons → user-facing RU phrase for the M8 banner (no infra detail). */
const PARTIAL_REASONS = {
  budget: 'исчерпан бюджет токенов',
  time: 'превышен лимит времени исследования',
  rounds: 'достигнут лимит этапов исследования',
  aborted: 'исследование остановлено',
  error: 'произошла ошибка во время исследования',
};

/** Prefixes a localized "partial report" banner when the run did not complete (M8). */
function withPartialBanner(text, finalizeReason) {
  const reason = PARTIAL_REASONS[finalizeReason];
  if (!reason) {
    return text;
  }
  return `> ⚠️ Частичный отчёт: ${reason}. Ниже — то, что удалось собрать.\n\n${text}`;
}

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

/**
 * DR chat title: a short TOPIC the lead model distills from the (masked) request, so any
 * phrasing ("Меня зовут…, сравни X и Y") still yields a clean subject line — and because
 * it runs on the MASKED question, the user's PII never lands in the title/sidebar. Reuses
 * the already-built, cached lead model. Fail-open: any error or empty result falls back to
 * the deterministic {@link buildDeepResearchTitle} heuristic.
 */
async function resolveDeepResearchTitle({ buildModel, leadModelSlug, topicText, fallbackText }) {
  const source = (topicText ?? '').trim();
  if (!source) {
    return buildDeepResearchTitle(fallbackText);
  }
  try {
    const model = await buildModel(leadModelSlug);
    const response = await model.invoke([
      new SystemMessage(
        'Сформулируй короткий заголовок ТЕМЫ исследования на русском: 3–7 слов, именительный падеж, без кавычек, без точки в конце, это тема, а не команда. Не включай имена людей, телефоны, e-mail и служебные метки вида PERSON_1. Верни только заголовок.',
      ),
      new HumanMessage(`Запрос пользователя: ${source}`),
    ]);
    const cleaned = cleanModelTitle(extractMessageText(response?.content));
    return cleaned ? capitalizeAndTruncateTitle(cleaned) : buildDeepResearchTitle(fallbackText);
  } catch (error) {
    logger.warn('[deepResearchRun] title generation failed; using heuristic fallback', error);
    return buildDeepResearchTitle(fallbackText);
  }
}

/** Soft per-user cap on concurrent active generations gating a new DR start (M1). */
const MAX_CONCURRENT_DR = Number(process.env.DEEP_RESEARCH_MAX_CONCURRENT) || 3;

/** Sentinel: the user is over the DR concurrency cap; short-circuits to a busy report. */
class DeepResearchCapError extends Error {}

/**
 * Count the user's OTHER active generation jobs (excluding this one) via the job
 * store — cluster-safe across Railway replicas (Redis-backed), unlike an in-process
 * Map. A soft proxy for DR concurrency; the economic backstop is H4 billing and the
 * precise hard cap is the Phase-3 queue. Fail-open: a counting error returns 0.
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

/** DR outcomes that yield a genuine, model-written report worth a PDF artifact (D4). A
 *  concurrency refusal (limit), an error fallback, and a user-aborted partial are skipped. */
const PDF_ELIGIBLE_REASONS = new Set(['completed', 'budget', 'rounds', 'time']);

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
    const buffer = await reportToPdfBuffer(markdown);
    const fileId = randomUUID();
    const displayName = `${(title || 'Отчёт').trim()}.pdf`;
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
 * D2 badge-independence: TRUE when the message replies to the assistant's clarify
 * questions. The routing gate uses this so answering a clarify prompt ALWAYS continues
 * into the research — even when the frontend's `deep_research` flag was lost (toggled
 * off, dropped on the new-chat key transition, etc.). Replying to the questions IS the
 * user's intent; without this the answer fell into normal chat and a plain model
 * improvised a source-less "report". Fail-closed: any error → false (normal chat).
 */
async function isClarifyFollowUp({ userId, conversationId, parentMessageId }) {
  if (!conversationId || !parentMessageId || parentMessageId === Constants.NO_PARENT) {
    return false;
  }
  try {
    const messages = await getMessages(
      { conversationId, user: userId, messageId: parentMessageId },
      'messageId text isCreatedByUser',
    );
    const parent = Array.isArray(messages) ? messages[0] : null;
    return Boolean(
      parent && parent.isCreatedByUser !== true && isClarifyMessage(parent.text ?? ''),
    );
  } catch (error) {
    logger.warn('[deepResearchRun] clarify follow-up check failed; routing to normal chat', error);
    return false;
  }
}

/**
 * D2 turn 2: if this message replies to a clarify prompt, assemble the whole dialogue
 * (original request → clarify questions → this answer) so the research uses the full
 * context. Returns null when it is NOT a clarify continuation, or on any load error
 * (fail-open → the runner treats the message as a fresh request).
 */
async function buildClarifyContinuation({ userId, conversationId, parentMessageId, answer }) {
  if (!parentMessageId || !conversationId) {
    return null;
  }
  try {
    const messages = await getMessages({ conversationId, user: userId });
    if (!Array.isArray(messages) || messages.length === 0) {
      return null;
    }
    const byId = new Map(messages.map((m) => [m.messageId, m]));
    const parent = byId.get(parentMessageId);
    if (!parent || !isClarifyMessage(parent.text ?? '')) {
      return null;
    }
    const original = parent.parentMessageId ? byId.get(parent.parentMessageId) : null;
    const originalText = (original?.text ?? '').trim();
    return [
      'Диалог уточнения задачи исследования.',
      originalText ? `\nИсходный запрос пользователя:\n${originalText}` : '',
      `\nУточняющие вопросы:\n${(parent.text ?? '').trim()}`,
      `\nОтвет пользователя:\n${(answer ?? '').trim()}`,
    ]
      .filter(Boolean)
      .join('\n');
  } catch (error) {
    logger.warn(
      '[deepResearchRun] failed to load clarify parent; treating as a fresh request',
      error,
    );
    return null;
  }
}

/**
 * D2 turn 1: ask the lead model whether the request is specific enough to research now or
 * needs clarifying questions. Runs on the MASKED question. Fail-open: any error → PROCEED
 * (research starts rather than the user being nagged with questions).
 */
async function runClarifyCheck({ buildModel, leadModelSlug, question, now }) {
  try {
    const model = await buildModel(leadModelSlug);
    const response = await model.invoke([
      new SystemMessage(buildClarifyPrompt({ now })),
      new HumanMessage(question),
    ]);
    return parseClarifyOutput(extractMessageText(response?.content));
  } catch (error) {
    logger.warn('[deepResearchRun] clarify check failed; proceeding to research', error);
    return { action: 'PROCEED', questions: [] };
  }
}

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
  } = params;

  // H1: emit `created` up front so the job is flagged createdEventEmitted=true and the
  // user message is persisted to the job store. Without it, a Stop during the (content-
  // less) research phase looks like an "early abort" to abortJob, which wipes the question
  // and bounces the user into an empty new chat. emitChunk is a no-op once aborted, so this
  // must run before any await that the user could interrupt. Mirrors the agent path's onStart.
  if (streamId && userMessage) {
    await GenerationJobManager.emitChunk(streamId, {
      created: true,
      message: { ...userMessage, sender: 'User', isCreatedByUser: true },
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
  const otherActiveJobs = await countOtherActiveJobs({
    streamId,
    userId,
    tenantId: req?.user?.tenantId,
  });
  try {
    if (otherActiveJobs >= MAX_CONCURRENT_DR) {
      throw new DeepResearchCapError();
    }

    // D2: when this message replies to a clarify prompt (turn 2), research the WHOLE dialogue
    // (original request → questions → answer); otherwise research the raw request (turn 1).
    // Fail-open: a parent-load failure → the raw request. `researchInput` is what gets masked.
    const clarifyEnabled = req.config?.deepResearch?.clarify !== false;
    const continuation = clarifyEnabled
      ? await buildClarifyContinuation({ userId, conversationId, parentMessageId, answer: text })
      : null;
    const isClarifyContinuation = continuation != null;
    const researchInput = continuation ?? text ?? '';

    // Track B (sovereign DR): mask the user's question ONCE, then run the graph in anonymizer
    // passthrough so ONLY user data (question + documents) is masked — never the public web.
    // Best-effort: any failure leaves `sovereign` null and DR runs the legacy full-masking path
    // (anonymizer masks all egress), which is safe — it just over-masks public content.
    let connection = null;
    try {
      connection = await resolveAnonymizerConnection({ req, db, endpoint, model: leadModelSlug });
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

    // D2 turn 1: if the request is under-specified for a targeted recommendation (and this is
    // NOT a reply to a clarify prompt), ask up to 3 clarifying questions as ONE assistant
    // message instead of researching. The questions flow through the SAME finalize tail below
    // (restore de-masks, save, title, final event) — no separate path.
    if (clarifyEnabled && !isClarifyContinuation) {
      const decision = await runClarifyCheck({
        buildModel,
        leadModelSlug,
        question: sovereign ? sovereign.maskedQuestion : researchInput,
        now: new Date().toISOString(),
      });
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

    // Skip the (expensive) graph build + run when clarify already produced the turn's message.
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
        buildModel(workerModelFor(tier, conversationModel)),
        buildModel(compressModelFor(tier, conversationModel)),
        buildModel(reportModelFor(tier, conversationModel)),
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
        // v1: progress is logged; rendered UI progress + token streaming ship after lab SSE validation.
        onProgress: (event) =>
          logger.info(
            `[deepResearchRun] ${event.type}${event.subQuestion ? `: ${event.subQuestion}` : ''}`,
          ),
      });
    }
  } catch (error) {
    if (error instanceof DeepResearchCapError) {
      logger.warn(
        `[deepResearchRun] user ${userId} at DR concurrency cap (${otherActiveJobs} active); rejecting`,
      );
      result = {
        finalReport:
          'У вас уже выполняется несколько задач одновременно. Дождитесь завершения текущих исследований и запустите это снова.',
        finalizeReason: 'limit',
        usage: { input: 0, output: 0, total: 0 },
        findings: [],
      };
    } else {
      logger.error('[deepResearchRun] failed to assemble or run DR; using fallback report', error);
      result = {
        finalReport: buildFallbackReport({
          brief: text ?? '',
          jurisdiction: '',
          findings: [],
          reason: sanitizeErrorForUser(error),
        }),
        finalizeReason: 'error',
        usage: { input: 0, output: 0, total: 0 },
        findings: [],
      };
    }
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

  // 'completed' is a full report; 'limit' is a deliberate, non-error refusal (concurrency
  // cap); 'clarify' is a clarifying-questions message (D2) — each stands alone and must NOT
  // get the frontend "unfinished" banner.
  const unfinished = !['completed', 'limit', 'clarify'].includes(result.finalizeReason);
  // Track B: de-mask the final report via the server-side run map (placeholders → real PII), then
  // free the map. restore never throws (worst case: placeholders remain — safe, not a leak); both
  // run for EVERY outcome incl. abort, so the partial report saved below is de-masked too.
  let reportText = result.finalReport;
  if (sovereign) {
    reportText = await sovereign.restore(result.finalReport);
    await sovereign.drop();
  }

  // P6+: chat title = a model-distilled TOPIC of the (masked) request — robust to any
  // phrasing and PII-free (it runs on the masked question). Computed once here so BOTH the
  // D4 PDF filename and the persisted conversation row reuse it. An aborted run skips the
  // model call (its title is never persisted); fail-open to the deterministic heuristic.
  const deepResearchTitle =
    result.finalizeReason === 'aborted'
      ? buildDeepResearchTitle(text)
      : await resolveDeepResearchTitle({
          buildModel,
          leadModelSlug,
          topicText: sovereign ? sovereign.maskedQuestion : text,
          fallbackText: text,
        });

  // Parity with the standard title pipeline (answers the gen_title 404): the frontend
  // eagerly polls GET /api/convos/gen_title/:conversationId (retrying 404s) for every
  // new conversation — populate the SAME cache the standard addTitle service fills, and
  // emit the same live 'title' SSE event, so DR titles behave exactly like normal chats.
  if (result.finalizeReason !== 'aborted' && !req?.body?.isTemporary) {
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

  // M8: a partial report is prefixed with a localized reason banner so the user knows
  // WHY it stopped (budget/time/rounds/abort/error). Baked into the saved text so a
  // reload shows it too; the frontend's generic "unfinished" banner (C1f) complements it.
  const finalReportText = withPartialBanner(reportText, result.finalizeReason);
  const responseMessage = {
    messageId: responseMessageId,
    conversationId,
    // H2: the report's parent is the user's QUESTION, not the question's parent.
    // Otherwise the report and the question become siblings and `buildTree` drops
    // the report on refetch (it vanishes on reload). Mirrors GenerationJobManager.
    parentMessageId: userMessage?.messageId ?? parentMessageId,
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

  const reqCtx = {
    userId,
    isTemporary: req?.body?.isTemporary,
    interfaceConfig: req?.config?.interfaceConfig,
  };

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
  // the race where a follow-up arrives before the response is persisted).
  if (userMessage) {
    await saveMessage(reqCtx, userMessage, { context: 'deepResearchRun - user message' });
  }
  await saveMessage(reqCtx, responseMessage, { context: 'deepResearchRun - final report' });

  // H4: bill the run's token usage (every outcome consumed tokens, including a Stop),
  // so Transactions/balance/spend-limits apply to DR. Runs before the abort early-return.
  await billDeepResearchUsage({
    userId,
    conversationId,
    messageId: responseMessageId,
    model: leadModelSlug,
    usage: result.usage,
  });

  // H1: on a user Stop the /abort route's abortJob already owns the SSE finalization
  // (and job cleanup), and the partial report is persisted above, so a reload shows it.
  // Emitting our own done here would double-finalize. Wall-clock/budget/rounds/error
  // partials are NOT user-aborted, so those still finalize through us below.
  if (result.finalizeReason === 'aborted') {
    return result;
  }

  // M9/M10: a NEW DR chat has no persisted Conversation row yet, so the sidebar would
  // show nothing until reload and the final event would carry an empty conversation.
  // Persist the row (with a deterministic title, never "New Chat") and build the final
  // object from it. A persistence hiccup degrades to a minimal object, never a failed run.
  let conversation = null;
  try {
    conversation = await getConvo(userId, conversationId);
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
    requestMessage: userMessage ? sanitizeMessageForTransmit(userMessage) : undefined,
    responseMessage,
  };

  if (streamId) {
    await GenerationJobManager.emitDone(streamId, finalEvent);
    GenerationJobManager.completeJob(streamId);
  } else {
    sendEvent(res, finalEvent);
    res.end();
  }

  return result;
}

module.exports = { runNewDeepResearch, buildDeepResearchTitle, isClarifyFollowUp };
