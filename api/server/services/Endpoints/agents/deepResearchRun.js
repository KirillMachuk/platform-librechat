const { randomUUID } = require('node:crypto');
const { Constants } = require('librechat-data-provider');
const { HumanMessage } = require('@langchain/core/messages');
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
  leadModelFor,
  workerModelFor,
  reportModelFor,
  compressModelFor,
} = require('@librechat/api');
const { logger } = require('@librechat/data-schemas');
const { createFileSearchTool } = require('~/app/clients/tools/util/fileSearch');
const { filterRequestFilesByAccess } = require('~/server/services/Files/permissions');
const { loadAuthValues } = require('~/server/services/Tools/credentials');
const {
  getFiles,
  getConvo,
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

/** Deterministic chat title from the research request (M9) — never "New Chat". */
function buildDeepResearchTitle(text) {
  const trimmed = (text ?? '').trim().replace(/\s+/g, ' ');
  if (!trimmed) {
    return 'Глубокое исследование';
  }
  // Slice by code points, not UTF-16 units, so a truncation can't split a surrogate
  // pair (emoji/astral char) into a lone surrogate that renders as a "�" glyph.
  const chars = [...trimmed];
  return chars.length > 60 ? `${chars.slice(0, 57).join('')}…` : trimmed;
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
      question: text ?? '',
      signal,
      logger,
    });
    passthroughHeaders = sovereign?.passthroughHeaders ?? null;
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
      input: { messages: [new HumanMessage(sovereign ? sovereign.maskedQuestion : (text ?? ''))] },
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

  // 'completed' is a full report; 'limit' is a deliberate, non-error refusal (concurrency
  // cap) whose message stands alone — neither should get the frontend "unfinished" banner.
  const unfinished = !['completed', 'limit'].includes(result.finalizeReason);
  // Track B: de-mask the final report via the server-side run map (placeholders → real PII), then
  // free the map. restore never throws (worst case: placeholders remain — safe, not a leak); both
  // run for EVERY outcome incl. abort, so the partial report saved below is de-masked too.
  let reportText = result.finalReport;
  if (sovereign) {
    reportText = await sovereign.restore(result.finalReport);
    await sovereign.drop();
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
        { conversationId, endpoint, model: leadModelSlug, title: buildDeepResearchTitle(text) },
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
    : { conversationId, endpoint, model: leadModelSlug, title: buildDeepResearchTitle(text) };

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

module.exports = { runNewDeepResearch };
