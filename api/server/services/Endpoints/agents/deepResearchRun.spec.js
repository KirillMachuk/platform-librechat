/**
 * Track B wiring: proves the sovereign session is threaded through the DR runner —
 * masked question into the graph, passthrough headers onto every model, final report
 * restored + run map dropped, saved report de-masked — and that the legacy path (no
 * session) stays byte-for-byte raw. The sovereign LOGIC itself is unit-tested in
 * packages/api/.../sovereign.spec.ts; here we only assert the glue.
 *
 * Vars referenced inside jest.mock factories are `mock`-prefixed (jest hoisting rule).
 */
const { HumanMessage } = require('@langchain/core/messages');

const mockModelCtorArgs = [];
const mockInvokeArgs = [];
const mockInvokeOptions = [];
let mockTitleContent = 'Сравнение CRM-систем';
let mockTitleThrows = false;
let mockClarifyContent = '{"action":"PROCEED","questions":[]}';
let mockPlanContent = '{"action":"PLAN","title":"Тема","steps":["Шаг 1","Шаг 2"]}';
class mockFakeModel {
  constructor(opts) {
    mockModelCtorArgs.push(opts);
  }
  async invoke(messages, options) {
    mockInvokeArgs.push(messages);
    mockInvokeOptions.push(options);
    if (mockTitleThrows) {
      throw new Error('title model unavailable');
    }
    const system = messages?.[0]?.content;
    if (typeof system === 'string' && system.includes('модуль УТОЧНЕНИЯ')) {
      return { content: mockClarifyContent };
    }
    if (typeof system === 'string' && system.includes('модуль ПЛАНИРОВАНИЯ')) {
      return { content: mockPlanContent };
    }
    return { content: mockTitleContent };
  }
}

const mockRunDeepResearch = jest.fn();
const mockStartSovereignSession = jest.fn();
const mockInitializeCustom = jest.fn();
const mockCreateDeepResearchGraph = jest.fn(() => ({}));
const mockEmitChunk = jest.fn();
const mockEmitDone = jest.fn();
const mockCompleteJob = jest.fn();
const mockSavedMessages = [];
/** What Mongo stamps on the saved message; the emitted final must carry it. */
const mockSavedAt = new Date('2026-07-15T10:00:00.000Z');
/** Mongo bookkeeping the emitted final must NOT carry. */
const mockSavedObjectId = 'ffffffffffffffffffffffff';
/**
 * What each `emitDone` actually put on the wire, snapshotted through JSON exactly as the
 * real one does before storing the event for late/cross-replica subscribers. Asserting on
 * `mockEmitDone.mock.calls` alone cannot see ordering: it holds a live reference, so a
 * message stamped AFTER the emit would still look stamped by the time a test reads it.
 */
const mockEmittedFinals = [];
const mockReportToPdfBuffer = jest.fn(async () => Buffer.from('%PDF-1.4 fake'));
const mockCreateFile = jest.fn(async (data) => ({ ...data }));
const mockSaveBuffer = jest.fn(async () => '/uploads/u1/report.pdf');
const mockGetStrategyFunctions = jest.fn(() => ({ saveBuffer: mockSaveBuffer }));
const mockTitleCacheSet = jest.fn(async () => {});
// Default to valid slugs; individual tests override to undefined to exercise the
// misconfigured-mode guard (A1 — every research node needs a non-reasoning model).
const mockLeadModelFor = jest.fn(() => 'lead-model');
const mockWorkerModelFor = jest.fn(() => 'worker-model');
const mockReportModelFor = jest.fn(() => 'report-model');
const mockCompressModelFor = jest.fn(() => 'compress-model');
// The stale-job guard reads the CURRENT job before the final emit; the default matches
// the run's own jobCreatedAt-less invocation (guard passes). Tests override to simulate
// a replaced job.
const mockGetJob = jest.fn(async () => ({ streamId: 'stream-1', createdAt: 1 }));

jest.mock('@librechat/agents', () => ({
  Providers: { OPENAI: 'openAI' },
  getChatModelClass: jest.fn(() => mockFakeModel),
  createSearchTool: jest.fn(() => ({ name: 'web_search' })),
}));

jest.mock('@librechat/api', () => ({
  sendEvent: jest.fn(),
  // Faithful subset of the real helpers (whose own logic is covered by the headers/env
  // unit tests): createSafeUser keeps id/role, resolveConfigHeaders substitutes the
  // {{LIBRECHAT_USER_ID}} placeholder in defaultHeaders in place. Enough to prove
  // buildNodeModel wires them so the user-id billing header is resolved, not left literal.
  createSafeUser: (u) => (u == null ? {} : { id: u.id, role: u.role }),
  resolveConfigHeaders: ({ llmConfig, user }) => {
    const headers = llmConfig?.configuration?.defaultHeaders;
    if (headers == null) {
      return;
    }
    for (const key of Object.keys(headers)) {
      if (typeof headers[key] === 'string') {
        headers[key] = headers[key].replace(/\{\{LIBRECHAT_USER_ID\}\}/g, user?.id ?? '');
      }
    }
  },
  initializeCustom: (...a) => mockInitializeCustom(...a),
  runDeepResearch: (...a) => mockRunDeepResearch(...a),
  startSovereignSession: (...a) => mockStartSovereignSession(...a),
  createDeepResearchGraph: (...a) => mockCreateDeepResearchGraph(...a),
  loadWebSearchAuth: jest.fn(async () => ({ authenticated: false })),
  tierToRunBudget: jest.fn(() => ({})),
  GenerationJobManager: {
    emitChunk: mockEmitChunk,
    emitDone: (streamId, event) => {
      mockEmittedFinals.push(JSON.parse(JSON.stringify(event)));
      return mockEmitDone(streamId, event);
    },
    completeJob: (...a) => mockCompleteJob(...a),
    getActiveJobIdsForUser: jest.fn(async () => []),
    getActiveDeepResearchCount: jest.fn(async () => 0),
    getJob: (...a) => mockGetJob(...a),
  },
  buildFallbackReport: jest.fn(() => 'FALLBACK'),
  recordCollectedUsage: jest.fn(async () => {}),
  sanitizeErrorForUser: jest.fn(() => 'ошибка'),
  resolveDeepResearchTier: jest.fn(() => ({ name: 'balanced', wallClockMinutes: 10 })),
  sanitizeMessageForTransmit: jest.fn((m) => m),
  selectChatFileSearchInputs: jest.fn(() => []),
  leadModelFor: (...a) => mockLeadModelFor(...a),
  workerModelFor: (...a) => mockWorkerModelFor(...a),
  reportModelFor: (...a) => mockReportModelFor(...a),
  compressModelFor: (...a) => mockCompressModelFor(...a),
  DeepResearchConfigError: class DeepResearchConfigError extends Error {},
  reportToPdfBuffer: (...a) => mockReportToPdfBuffer(...a),
  getStorageMetadata: jest.fn(() => ({})),
  getProviderConfig: ({ provider, appConfig }) => ({
    customEndpointConfig: appConfig?.endpoints?.custom?.find?.((e) => e?.name === provider),
  }),
  // Faithful mirror of the real disableTitleReasoning (packages/api/src/agents/client.ts,
  // unit-tested there). Mirrored rather than spied so these tests assert the OUTCOME on the
  // built model, not merely that a function was called.
  disableTitleReasoning: (clientOptions) => {
    if (clientOptions.include_reasoning !== true) {
      return;
    }
    clientOptions.include_reasoning = false;
    clientOptions.modelKwargs = { ...clientOptions.modelKwargs, reasoning: { enabled: false } };
  },
  // Faithful mirror of the real length-estimate fallback (no usage_metadata on fakes).
  usageFromExchange: (prompt, response) => {
    const promptText = prompt.map((m) => String(m.content ?? '')).join(' ');
    const responseText = typeof response?.content === 'string' ? response.content : '';
    const input = Math.ceil(promptText.length / 4);
    const output = Math.ceil(responseText.length / 4);
    return { input, output, total: input + output };
  },
  // Same arithmetic as the mock above — the runner reconciles the split against the
  // aggregate, so two mocks that disagreed would fail every run for a reason of their own.
  usageByModelFromExchange: (prompt, response, fallback) => {
    const promptText = prompt.map((m) => String(m.content ?? '')).join(' ');
    const responseText = typeof response?.content === 'string' ? response.content : '';
    const input = Math.ceil(promptText.length / 4);
    const output = Math.ceil(responseText.length / 4);
    const name = response?.response_metadata?.model_name || fallback;
    return { [name]: { input, output, total: input + output, estimated: input + output } };
  },
  mergeUsageByModel: (acc, delta) => {
    const merged = { ...acc };
    for (const [model, usage] of Object.entries(delta)) {
      const prev = merged[model] ?? { input: 0, output: 0, total: 0, estimated: 0 };
      merged[model] = {
        input: prev.input + usage.input,
        output: prev.output + usage.output,
        total: prev.total + usage.total,
        estimated: prev.estimated + usage.estimated,
      };
    }
    return merged;
  },
  // D2 clarify helpers — faithful mirrors of the real clarify.ts (unit-tested there); the
  // system prompt carries the 'модуль УТОЧНЕНИЯ' marker the fake model branches on.
  buildClarifyPrompt: ({ now }) => `Ты — модуль УТОЧНЕНИЯ. ${now}`,
  parseClarifyOutput: (text) => {
    try {
      const parsed = JSON.parse(text);
      const questions = Array.isArray(parsed.questions)
        ? parsed.questions.filter((q) => typeof q === 'string' && q.trim()).slice(0, 3)
        : [];
      return parsed.action === 'CLARIFY' && questions.length
        ? { action: 'CLARIFY', questions }
        : { action: 'PROCEED', questions: [] };
    } catch {
      return { action: 'PROCEED', questions: [] };
    }
  },
  formatClarifyMessage: (questions) =>
    `**Уточните, пожалуйста, детали исследования:**\n${questions
      .map((q, i) => `${i + 1}. ${q}`)
      .join('\n')}\n\nОтветьте сообщением.`,
  isClarifyMessage: (text) =>
    typeof text === 'string' &&
    text.trimStart().startsWith('**Уточните, пожалуйста, детали исследования:**'),
  // Task #21 plan-gate helpers — faithful mirrors of plan.ts (unit-tested there); the
  // system prompt carries the 'модуль ПЛАНИРОВАНИЯ' marker the fake model branches on.
  buildPlanPrompt: ({ now, allowClarify = true, isRefinement = false }) =>
    `Ты — модуль ПЛАНИРОВАНИЯ. ${now}${allowClarify ? '' : ' CLARIFY запрещено'}${
      isRefinement ? ' РЕЖИМ ПРАВКИ ПЛАНА' : ''
    }`,
  parsePlanDecision: (text, { allowClarify = true } = {}) => {
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    const action = String(parsed?.action ?? '').toUpperCase();
    const clean = (v, cap) =>
      Array.isArray(v)
        ? [
            ...new Set(v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim())),
          ].slice(0, cap)
        : [];
    const questions = clean(parsed?.questions, 3);
    const steps = clean(parsed?.steps, 6);
    const title = typeof parsed?.title === 'string' ? parsed.title.trim() : '';
    if (action === 'CLARIFY' && allowClarify && questions.length) {
      return { action: 'CLARIFY', questions, title: '', steps: [] };
    }
    if (action === 'PROCEED') {
      return { action: 'PROCEED', questions: [], title: '', steps: [] };
    }
    // Review r2: ambiguity fails CLOSED to PLAN (possibly with empty steps — the runner
    // substitutes its deterministic fallback plan). Mirrors plan.ts.
    return { action: 'PLAN', questions: [], title, steps };
  },
  formatPlanMessage: ({ title, steps }) =>
    `${`**План исследования:** ${title}`.trimEnd()}\n\n${steps
      .map((s, i) => `${i + 1}. ${s}`)
      .join('\n')}`,
  isPlanMessage: (text) =>
    typeof text === 'string' && text.trimStart().startsWith('**План исследования:**'),
  isStartCommand: (text) =>
    typeof text === 'string' &&
    ['Начать исследование', 'Начать исследование'].includes(text.trim()),
  isCancelCommand: (text) =>
    typeof text === 'string' &&
    ['Отменить исследование', 'Отменить исследование'].includes(text.trim()),
  extractPlanSteps: (planMessage) => {
    const steps = [];
    for (const line of String(planMessage ?? '').split(/\r?\n/)) {
      const m = line.match(/^\s*\d+\.\s+(.*\S)\s*$/);
      if (m) {
        steps.push(m[1].trim());
      }
    }
    return steps;
  },
  CANCELLED_MESSAGE: 'Исследование отменено.',
}));

jest.mock('@librechat/data-schemas', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('~/app/clients/tools/util/fileSearch', () => ({ createFileSearchTool: jest.fn() }));
jest.mock('~/server/services/Files/permissions', () => ({
  filterRequestFilesByAccess: jest.fn(async () => []),
}));
jest.mock('~/server/services/Tools/credentials', () => ({ loadAuthValues: jest.fn() }));
jest.mock('~/server/services/Files/strategies', () => ({
  getStrategyFunctions: (...a) => mockGetStrategyFunctions(...a),
}));
jest.mock('~/cache/getLogStores', () =>
  jest.fn(() => ({ set: (...a) => mockTitleCacheSet(...a), get: jest.fn(), delete: jest.fn() })),
);

jest.mock('~/models', () => ({
  createFile: (...a) => mockCreateFile(...a),
  getFiles: jest.fn(async () => []),
  // Default = no persisted row (a NEW conversation): the model-title path runs. Tests for
  // title-once (review r2) override with a titled row and assert the call is skipped.
  getConvo: jest.fn(async () => null),
  getMessages: jest.fn(async () => []),
  saveConvo: jest.fn(async () => ({ conversationId: 'c1' })),
  saveMessage: jest.fn(async (ctx, msg) => {
    mockSavedMessages.push(msg);
    /** Faithful to the real one: Mongo's `timestamps: true` stamps the doc on write and
     *  `saveMessage` hands back the PERSISTED object (findOneAndUpdate + toObject), not the
     *  argument. Returning the argument verbatim is what let the live/persisted divergence
     *  ship — the emitted final looked stamped in tests and wasn't in production. The
     *  Mongo-only fields are here so that a fix which copies the doc wholesale into the
     *  emitted message is caught leaking them, rather than passing on a mock too poor to
     *  carry them. */
    return {
      ...msg,
      _id: mockSavedObjectId,
      __v: 0,
      createdAt: mockSavedAt,
      updatedAt: mockSavedAt,
    };
  }),
  spendTokens: jest.fn(),
  getMultiplier: jest.fn(),
  getConvoFiles: jest.fn(async () => []),
  updateBalance: jest.fn(),
  getCacheMultiplier: jest.fn(),
  spendStructuredTokens: jest.fn(),
  bulkInsertTransactions: jest.fn(),
}));

const {
  runNewDeepResearch,
  buildDeepResearchTitle,
  isDrFollowUp,
  buildDeepResearchCollectedUsage,
} = require('./deepResearchRun');

function baseParams(text) {
  return {
    req: {
      config: { fileStrategy: 'local', deepResearch: { clarify: false } },
      user: { role: 'user' },
      body: {},
    },
    res: {},
    streamId: 'stream-1',
    signal: undefined,
    endpoint: '1ma',
    conversationModel: 'gpt',
    userId: 'u1',
    conversationId: 'c1',
    parentMessageId: 'p1',
    responseMessageId: 'r1',
    sender: 'Deep Research',
    // Mirrors getPreliminaryUserMessage's real shape (request.js) — the run relies on
    // conversationId being present for the DB save.
    userMessage: { messageId: 'um1', parentMessageId: 'p1', conversationId: 'c1', text },
    text,
  };
}

const REPORT = 'Отчёт про [PERSON_1] и публичную компанию Apple';

beforeEach(() => {
  jest.clearAllMocks();
  mockSavedMessages.length = 0;
  mockEmittedFinals.length = 0;
  mockModelCtorArgs.length = 0;
  mockInvokeArgs.length = 0;
  mockInvokeOptions.length = 0;
  mockTitleContent = 'Сравнение CRM-систем';
  mockTitleThrows = false;
  mockClarifyContent = '{"action":"PROCEED","questions":[]}';
  mockPlanContent = '{"action":"PLAN","title":"Тема","steps":["Шаг 1","Шаг 2"]}';
  mockInitializeCustom.mockResolvedValue({
    llmConfig: { apiKey: 'sk-client', provider: 'openAI' },
    configOptions: {
      baseURL: 'http://anon.internal:8000/v1',
      defaultHeaders: { 'X-Existing': '1' },
    },
    provider: 'openAI',
  });
  mockRunDeepResearch.mockResolvedValue({
    finalReport: REPORT,
    finalizeReason: 'completed',
    usage: { input: 10, output: 20, total: 30 },
    // The real engine reports the same tokens split by answering model; a worker slug here
    // (not the lead) is what makes lead-rate billing visible when it happens.
    usageByModel: { 'vendor/worker-x': { input: 10, output: 20, total: 30, estimated: 0 } },
    findings: [],
  });
});

describe('runNewDeepResearch — sovereign wiring (Track B)', () => {
  it('masks question in, passes passthrough headers to every model, restores + drops, saves de-masked report', async () => {
    const restore = jest.fn(async (t) => t.replace('[PERSON_1]', 'Иван Иванов'));
    const drop = jest.fn(async () => {});
    mockStartSovereignSession.mockResolvedValue({
      maskedQuestion: 'Проверь [PERSON_1]',
      passthroughHeaders: { 'X-Anon-Passthrough': '1', 'X-Anon-Passthrough-Token': 'secret' },
      maskContent: jest.fn(async (t) => t),
      restore,
      drop,
    });

    await runNewDeepResearch(baseParams('Проверь Иванова Ивана'));

    // (1) session started with the run id (= streamId) and the raw question
    expect(mockStartSovereignSession).toHaveBeenCalledTimes(1);
    const startArg = mockStartSovereignSession.mock.calls[0][0];
    expect(startArg.runId).toBe('stream-1');
    expect(startArg.userId).toBe('u1');
    expect(startArg.question).toBe('Проверь Иванова Ивана');

    // (2) the graph receives the MASKED question, keyed by the same runId
    const runArg = mockRunDeepResearch.mock.calls[0][0];
    expect(runArg.input.messages[0]).toBeInstanceOf(HumanMessage);
    expect(runArg.input.messages[0].content).toBe('Проверь [PERSON_1]');
    expect(runArg.configurable.runId).toBe('stream-1');

    // (3) EVERY model carries passthrough headers, merged over the endpoint's existing headers
    expect(mockModelCtorArgs.length).toBeGreaterThanOrEqual(1);
    for (const opts of mockModelCtorArgs) {
      expect(opts.configuration.defaultHeaders).toEqual({
        'X-Existing': '1',
        'X-Anon-Passthrough': '1',
        'X-Anon-Passthrough-Token': 'secret',
      });
    }

    // (4) final report restored, then map dropped
    expect(restore).toHaveBeenCalledWith(REPORT);
    expect(drop).toHaveBeenCalledTimes(1);

    // (5) the SAVED report is de-masked (real name present, placeholder gone)
    const reportMsg = mockSavedMessages.find((m) => m.messageId === 'r1');
    expect(reportMsg.text).toContain('Иван Иванов');
    expect(reportMsg.text).not.toContain('[PERSON_1]');
    expect(reportMsg.text).toContain('Apple'); // public entity never masked
  });

  it('legacy path (no session): raw question in, no passthrough headers, no restore/drop, raw report saved', async () => {
    mockStartSovereignSession.mockResolvedValue(null);

    await runNewDeepResearch(baseParams('Проверь Иванова Ивана'));

    const runArg = mockRunDeepResearch.mock.calls[0][0];
    expect(runArg.input.messages[0].content).toBe('Проверь Иванова Ивана'); // raw

    for (const opts of mockModelCtorArgs) {
      expect(opts.configuration.defaultHeaders).toEqual({ 'X-Existing': '1' }); // untouched
      expect(opts.configuration.defaultHeaders['X-Anon-Passthrough']).toBeUndefined();
    }

    const reportMsg = mockSavedMessages.find((m) => m.messageId === 'r1');
    expect(reportMsg.text).toBe(REPORT); // saved exactly as the engine produced it
  });

  it('passes the ANON_PASSTHROUGH_TOKEN env as the passthrough secret', async () => {
    const prev = process.env.ANON_PASSTHROUGH_TOKEN;
    process.env.ANON_PASSTHROUGH_TOKEN = 'env-secret';
    mockStartSovereignSession.mockResolvedValue(null);
    try {
      await runNewDeepResearch(baseParams('q'));
      expect(mockStartSovereignSession.mock.calls[0][0].passthroughToken).toBe('env-secret');
    } finally {
      if (prev === undefined) {
        delete process.env.ANON_PASSTHROUGH_TOKEN;
      } else {
        process.env.ANON_PASSTHROUGH_TOKEN = prev;
      }
    }
  });
});

describe('buildDeepResearchTitle (D3 — topic title, not the raw imperative query)', () => {
  it('strips the leading imperative and capitalizes into a topic', () => {
    expect(buildDeepResearchTitle('проведи исследование рынка CRM в России')).toBe(
      'Исследование рынка CRM в России',
    );
    expect(buildDeepResearchTitle('Изучи лучшие 1С-решения')).toBe('Лучшие 1С-решения');
    expect(buildDeepResearchTitle('Пожалуйста, подготовь обзор рынка ЭДО')).toBe('Обзор рынка ЭДО');
  });

  it('keeps a plain topic as-is (just capitalized)', () => {
    expect(buildDeepResearchTitle('рынок облачных касс в Казахстане')).toBe(
      'Рынок облачных касс в Казахстане',
    );
  });

  it('falls back to a default for empty input', () => {
    expect(buildDeepResearchTitle('')).toBe('Глубокое исследование');
    expect(buildDeepResearchTitle('   ')).toBe('Глубокое исследование');
  });

  it('truncates very long topics by code points with an ellipsis', () => {
    const title = buildDeepResearchTitle(`исследование ${'а'.repeat(100)}`);
    expect([...title].length).toBeLessThanOrEqual(60);
    expect(title.endsWith('…')).toBe(true);
  });
});

describe('resolveDeepResearchTitle (topic title from the masked question, PII-free)', () => {
  const models = require('~/models');

  it('titles a NEW conversation from the MASKED question via the lead model, stripping quotes', async () => {
    mockStartSovereignSession.mockResolvedValue({
      maskedQuestion: 'Меня зовут [PERSON_1], сравни Битрикс24 и AmoCRM',
      passthroughHeaders: {},
      maskContent: jest.fn(async (t) => t),
      restore: jest.fn(async (t) => t),
      drop: jest.fn(async () => {}),
    });
    models.getConvo.mockResolvedValueOnce(null); // NEW chat → a title must be minted
    mockTitleContent = '«Сравнение CRM Битрикс24 и AmoCRM»';

    await runNewDeepResearch(baseParams('Меня зовут Кирилл Мачук, сравни Битрикс24 и AmoCRM'));

    // the title model saw the MASKED question — placeholder in, real name never
    const human = mockInvokeArgs[0].find((m) => m instanceof HumanMessage);
    expect(human.content).toContain('[PERSON_1]');
    expect(human.content).not.toContain('Кирилл');

    // quotes stripped; saved as the conversation title
    expect(models.saveConvo.mock.calls[0][1].title).toBe('Сравнение CRM Битрикс24 и AmoCRM');
  });

  it('falls back to the deterministic heuristic when the title model fails', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    models.getConvo.mockResolvedValueOnce(null);
    mockTitleThrows = true;

    await runNewDeepResearch(baseParams('изучи рынок ЭДО'));

    expect(models.saveConvo.mock.calls[0][1].title).toBe('Рынок ЭДО');
  });

  it('uses the endpoint titlePrompt from config — DR obeys the SAME title rules as normal chats', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    const params = baseParams('изучи рынок CRM');
    params.req.config.endpoints = {
      custom: [
        {
          name: '1ma',
          titlePrompt: 'Максимум 4 слова, без кавычек.\n\nДиалог:\n{convo}',
          titleModel: 'anthropic/claude-sonnet-4.6',
        },
      ],
    };

    await runNewDeepResearch(params);

    const titlePrompt = mockInvokeArgs
      .map((messages) => messages?.[0]?.content)
      .find((content) => typeof content === 'string' && content.includes('Максимум 4 слова'));
    expect(titlePrompt).toBeDefined();
    expect(titlePrompt).toContain('Пользователь: изучи рынок CRM');
    expect(titlePrompt).not.toContain('{convo}');
  });
});

describe('runNewDeepResearch — D4 report PDF artifact', () => {
  const api = require('@librechat/api');

  it('attaches a PDF file to the response message on a completed report', async () => {
    mockStartSovereignSession.mockResolvedValue(null);

    await runNewDeepResearch(baseParams('изучи рынок CRM'));

    expect(mockReportToPdfBuffer).toHaveBeenCalledTimes(1);
    const reportMsg = mockSavedMessages.find((m) => m.messageId === 'r1');
    expect(reportMsg.files).toHaveLength(1);
    expect(reportMsg.files[0].type).toBe('application/pdf');
    expect(reportMsg.files[0].filename).toMatch(/\.pdf$/);
    expect(mockCreateFile.mock.calls[0][1]).toBe(true); // disableTTL
  });

  it('skips the PDF (and never generates one) for a temporary chat', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    const params = baseParams('изучи рынок CRM');
    params.req.body.isTemporary = true;

    await runNewDeepResearch(params);

    expect(mockReportToPdfBuffer).not.toHaveBeenCalled();
    expect(mockSavedMessages.find((m) => m.messageId === 'r1').files).toBeUndefined();
  });

  it('sends the report without a file when PDF generation fails (fail-open)', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    mockReportToPdfBuffer.mockRejectedValueOnce(new Error('pdf boom'));

    await runNewDeepResearch(baseParams('изучи рынок CRM'));

    const reportMsg = mockSavedMessages.find((m) => m.messageId === 'r1');
    expect(reportMsg.files).toBeUndefined();
    expect(reportMsg.text).toBe(REPORT); // report still delivered
  });

  it('skips the PDF for a non-report outcome (concurrency limit)', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    api.GenerationJobManager.getActiveJobIdsForUser.mockResolvedValueOnce(['a', 'b', 'c']);

    await runNewDeepResearch(baseParams('изучи рынок CRM'));

    expect(mockReportToPdfBuffer).not.toHaveBeenCalled();
    expect(mockSavedMessages.find((m) => m.messageId === 'r1').files).toBeUndefined();
  });
});

describe('runNewDeepResearch — global concurrency cap (M2)', () => {
  const api = require('@librechat/api');

  beforeEach(() => {
    mockStartSovereignSession.mockResolvedValue(null);
  });

  it('refuses a start when the server is saturated, without running the graph', async () => {
    api.GenerationJobManager.getActiveDeepResearchCount.mockResolvedValueOnce(20);

    const result = await runNewDeepResearch(baseParams('изучи рынок CRM'));

    expect(result.finalizeReason).toBe('limit');
    expect(mockRunDeepResearch).not.toHaveBeenCalled();
    const msg = mockSavedMessages.find((m) => m.messageId === 'r1');
    expect(msg.text).toContain('сервис загружен');
    // A refusal carries no report marker, so the next turn drops back to normal chat.
    expect(msg.drKind).toBeUndefined();
  });

  it('lets a start through when the server is just under the cap', async () => {
    api.GenerationJobManager.getActiveDeepResearchCount.mockResolvedValueOnce(19);

    await runNewDeepResearch(baseParams('изучи рынок CRM'));

    expect(mockRunDeepResearch).toHaveBeenCalledTimes(1);
  });

  it('checks the per-user cap first and skips the global scan when it trips', async () => {
    api.GenerationJobManager.getActiveJobIdsForUser.mockResolvedValueOnce(['a', 'b', 'c']);

    const result = await runNewDeepResearch(baseParams('изучи рынок CRM'));

    expect(result.finalizeReason).toBe('limit');
    const msg = mockSavedMessages.find((m) => m.messageId === 'r1');
    expect(msg.text).toContain('уже выполняется несколько задач');
    // Per-user refusal short-circuits before the global scan is ever paid for.
    expect(api.GenerationJobManager.getActiveDeepResearchCount).not.toHaveBeenCalled();
  });
});

describe('runNewDeepResearch — misconfigured-mode guard (A1)', () => {
  it('refuses with a clear message and never runs the graph when the lead model resolves to undefined', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    // Simulate an all-reasoning mode: resolveDeepResearchModel returns undefined
    // (never a reasoning model) for the lead node.
    mockLeadModelFor.mockReturnValueOnce(undefined);

    await runNewDeepResearch(baseParams('изучи рынок CRM'));

    expect(mockRunDeepResearch).not.toHaveBeenCalled();
    const msg = mockSavedMessages.find((m) => m.messageId === 'r1');
    expect(msg.text).toContain('Глубокое исследование сейчас недоступно из-за настроек');
  });

  it('also refuses when the worker model resolves to undefined', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    mockWorkerModelFor.mockReturnValueOnce(undefined);

    await runNewDeepResearch(baseParams('изучи рынок CRM'));

    expect(mockRunDeepResearch).not.toHaveBeenCalled();
    const msg = mockSavedMessages.find((m) => m.messageId === 'r1');
    expect(msg.text).toContain('Глубокое исследование сейчас недоступно из-за настроек');
  });

  it('runs the graph normally when every model resolves (guard is a no-op)', async () => {
    mockStartSovereignSession.mockResolvedValue(null);

    await runNewDeepResearch(baseParams('сравни Битрикс24 и AmoCRM по цене за 2026 год'));

    expect(mockRunDeepResearch).toHaveBeenCalledTimes(1);
  });
});

describe('runNewDeepResearch — D2 clarify (two-turn)', () => {
  const models = require('~/models');

  function clarifyParams(text) {
    const p = baseParams(text);
    p.req.config.deepResearch = { clarify: true };
    return p;
  }

  it('turn 1: an under-specified request asks clarifying questions and does NOT run the graph', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    mockClarifyContent = '{"action":"CLARIFY","questions":["Какой масштаб бизнеса?","Бюджет?"]}';

    await runNewDeepResearch(clarifyParams('посоветуй CRM'));

    expect(mockRunDeepResearch).not.toHaveBeenCalled();
    const msg = mockSavedMessages.find((m) => m.messageId === 'r1');
    expect(msg.text).toContain('Уточните, пожалуйста, детали исследования');
    expect(msg.text).toContain('1. Какой масштаб бизнеса?');
    expect(msg.unfinished).toBe(false);
  });

  it('turn 1: a specific-enough request PROCEEDs straight to the graph', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    mockClarifyContent = '{"action":"PROCEED","questions":[]}';

    await runNewDeepResearch(clarifyParams('сравни Битрикс24 и AmoCRM по цене за 2026 год'));

    expect(mockRunDeepResearch).toHaveBeenCalledTimes(1);
  });

  it('turn 1: the sovereign clarify message is restored (de-masked) before saving', async () => {
    mockStartSovereignSession.mockResolvedValue({
      maskedQuestion: 'посоветуй CRM для [PERSON_1]',
      passthroughHeaders: {},
      maskContent: jest.fn(async (t) => t),
      restore: jest.fn(async (t) => t.replace('[PERSON_1]', 'Иван')),
      drop: jest.fn(async () => {}),
    });
    mockClarifyContent = '{"action":"CLARIFY","questions":["Для [PERSON_1]: какой бюджет?"]}';

    await runNewDeepResearch(clarifyParams('посоветуй CRM'));

    const msg = mockSavedMessages.find((m) => m.messageId === 'r1');
    expect(msg.text).toContain('Иван');
    expect(msg.text).not.toContain('[PERSON_1]');
    expect(mockRunDeepResearch).not.toHaveBeenCalled();
  });

  it('turn 2: a reply to a clarify prompt researches the whole dialogue and skips a 2nd clarify', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    models.getMessages.mockResolvedValueOnce([
      { messageId: 'q0', parentMessageId: null, isCreatedByUser: true, text: 'посоветуй CRM' },
      {
        messageId: 'p1',
        parentMessageId: 'q0',
        isCreatedByUser: false,
        drKind: 'clarify',
        text: '**Уточните, пожалуйста, детали исследования:**\n1. Масштаб?',
      },
    ]);
    mockClarifyContent = '{"action":"CLARIFY","questions":["не должно быть использовано"]}';

    await runNewDeepResearch(clarifyParams('малый бизнес, до 10 человек'));

    expect(mockRunDeepResearch).toHaveBeenCalledTimes(1);
    const input = mockRunDeepResearch.mock.calls[0][0].input.messages[0].content;
    expect(input).toContain('Диалог по задаче исследования');
    expect(input).toContain('Уточняющие вопросы');
    expect(input).toContain('посоветуй CRM');
    expect(input).toContain('малый бизнес');
  });

  it('clarify flag off → no clarify check, the graph runs even for a vague request', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    mockClarifyContent = '{"action":"CLARIFY","questions":["Q?"]}';

    await runNewDeepResearch(baseParams('посоветуй что-нибудь')); // baseParams has clarify:false

    expect(mockRunDeepResearch).toHaveBeenCalledTimes(1);
  });
});

describe('runNewDeepResearch — title parity with the standard pipeline (gen_title 404 fix)', () => {
  it('caches the title in GEN_TITLE and emits the live title event, like addTitle does', async () => {
    const api = require('@librechat/api');
    mockStartSovereignSession.mockResolvedValue(null);

    await runNewDeepResearch(baseParams('изучи рынок CRM'));

    // The frontend polls GET /api/convos/gen_title/:conversationId (retrying 404s) for
    // every new chat — the cache entry is what turns that 404 into a 200.
    expect(mockTitleCacheSet).toHaveBeenCalledWith('u1-c1', 'Сравнение CRM-систем', 120000);
    const titleEvents = api.GenerationJobManager.emitChunk.mock.calls.filter(
      ([, chunk]) => chunk?.event === 'title',
    );
    expect(titleEvents).toHaveLength(1);
    expect(titleEvents[0][1].data).toEqual({ conversationId: 'c1', title: 'Сравнение CRM-систем' });
  });
});

describe('runNewDeepResearch — honest nodata outcome', () => {
  it('a nodata run gets NO PDF and is NOT flagged unfinished (the notice stands alone)', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    mockRunDeepResearch.mockResolvedValueOnce({
      finalReport: '## Не удалось собрать материал\n…',
      finalizeReason: 'nodata',
      usage: { input: 5, output: 5, total: 10 },
      findings: [],
      errors: [{ node: 'researcher', message: 'search dead', at: 'now' }],
    });

    await runNewDeepResearch(baseParams('изучи рынок CRM'));

    expect(mockReportToPdfBuffer).not.toHaveBeenCalled();
    const msg = mockSavedMessages.find((m) => m.messageId === 'r1');
    expect(msg.files).toBeUndefined();
    // The notice IS the whole message — nothing usable sits above it, so the frontend
    // indicator ("…results shown above are still usable") would contradict it.
    expect(msg.unfinished).toBe(false);
    expect(msg.text).toContain('Не удалось собрать материал');
  });
});

describe('runNewDeepResearch — a Stop reaches the client LIVE (no reload needed)', () => {
  it('EMITS the stopped notice on a Stop instead of leaving the client hanging', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    mockRunDeepResearch.mockResolvedValueOnce({
      finalReport: 'что-то собранное',
      finalizeReason: 'aborted',
      usage: { input: 5, output: 5, total: 10 },
      findings: [{ round: 1, subQuestion: 'q', digest: 'd', sources: [], tokens: 10 }],
      errors: [],
    });

    await runNewDeepResearch(baseParams('изучи рынок CRM'));

    // The live bug: this run used to return early and stay silent, so the client only ever
    // saw the abort route's EMPTY synthetic final and the real notice appeared on reload.
    expect(mockEmitDone).toHaveBeenCalledTimes(1);
    const [streamId, finalEvent] = mockEmitDone.mock.calls[0];
    expect(streamId).toBe('stream-1');
    expect(finalEvent.final).toBe(true);
    expect(finalEvent.responseMessage.text).toContain('Исследование остановлено');
    // Without drKind the follow-up comment can't re-plan the original plan (task #21).
    expect(finalEvent.responseMessage.drKind).toBe('aborted');
    expect(mockCompleteJob).toHaveBeenCalledWith('stream-1');
  });
});

/**
 * The live final and the one a reload refetches must be the SAME message. They were not:
 * the emitted object was hand-built and carried no timestamps, while `responseMessageId` is
 * the preliminary `<userMessageId>_`. A trailing-underscore assistant message with no
 * `createdAt` is precisely what the chat calls a still-streaming placeholder
 * (`hasPendingAssistantParent`, client useChatFunctions.ts:75-81) — so while it sat at the
 * tip, `ask` refused every submit: the composer went silently dead and the plan card's
 * Начать did nothing. A reload "fixed" it only because Mongo returns the message stamped.
 */
describe('runNewDeepResearch — the live final is the persisted message, not a placeholder', () => {
  it.each([
    ['a report', { finalReport: '# Отчёт', finalizeReason: 'completed' }],
    ['a Stop', { finalReport: 'собранное', finalizeReason: 'aborted' }],
  ])('%s final carries the persisted timestamps', async (_label, runResult) => {
    mockStartSovereignSession.mockResolvedValue(null);
    mockRunDeepResearch.mockResolvedValueOnce({
      usage: { input: 5, output: 5, total: 10 },
      findings: [],
      errors: [],
      ...runResult,
    });

    await runNewDeepResearch(baseParams('изучи рынок CRM'));

    // Read the JSON snapshot taken AT emit time, not the live object: stamping the message
    // after the emit would leave late and cross-replica subscribers with the unstamped one
    // (`emitDone` serialises the event), yet a test reading the live reference could not
    // tell the difference.
    const { responseMessage } = mockEmittedFinals[0];
    expect(responseMessage.createdAt).toBe(mockSavedAt.toISOString());
    expect(responseMessage.updatedAt).toBe(mockSavedAt.toISOString());
    // The id stays preliminary on purpose — the next turn threads onto it. It is the
    // MISSING TIMESTAMP that made the pair look unfinished, not the id.
    expect(responseMessage.messageId).toBe('r1');
    // Mongo's own bookkeeping is not the client's business.
    expect(responseMessage._id).toBeUndefined();
    expect(responseMessage.__v).toBeUndefined();
  });

  it('survives a save that returns nothing — no timestamps, but never a crash', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    mockRunDeepResearch.mockResolvedValueOnce({
      finalReport: '# Отчёт',
      finalizeReason: 'completed',
      usage: { input: 5, output: 5, total: 10 },
      findings: [],
      errors: [],
    });
    const { saveMessage } = require('~/models');
    const persist = saveMessage.getMockImplementation();
    // Keyed on the context, not on call order: the run saves more than once, so a bare
    // `mockImplementationOnce` would starve the wrong call.
    saveMessage.mockImplementation(async (ctx, msg, meta) =>
      meta?.context === 'deepResearchRun - final report' ? undefined : persist(ctx, msg, meta),
    );

    try {
      await expect(runNewDeepResearch(baseParams('изучи рынок CRM'))).resolves.toBeDefined();
    } finally {
      saveMessage.mockImplementation(persist);
    }

    const { responseMessage } = mockEmittedFinals[0];
    expect(responseMessage.createdAt).toBeUndefined();
    expect(responseMessage.text).toContain('Отчёт');
  });
});

describe('runNewDeepResearch — a failure notice never poses as a report', () => {
  it('a hard-watchdog time-out gets NO PDF, NO report card and NO unfinished flag', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    // The run wrapper reports 'time' ONLY when the graph produced no report at all
    // (`resultFrom`: a real report keeps its own reason), so the text is the honest notice.
    mockRunDeepResearch.mockResolvedValueOnce({
      finalReport: '## Не удалось сформировать отчёт\nпревышен лимит времени исследования',
      finalizeReason: 'time',
      usage: { input: 5, output: 5, total: 10 },
      findings: [{ round: 1, subQuestion: 'q', digest: 'd', sources: [], tokens: 10 }],
      errors: [],
    });

    await runNewDeepResearch(baseParams('изучи рынок CRM'));

    const msg = mockSavedMessages.find((m) => m.messageId === 'r1');
    // A PDF whose only content is "не удалось сформировать отчёт" is a useless file.
    expect(mockReportToPdfBuffer).not.toHaveBeenCalled();
    expect(msg.files).toBeUndefined();
    expect(msg.drKind).toBeUndefined();
    expect(msg.unfinished).toBe(false);
  });

  it('a budget-capped run IS a real report: PDF, report card, and the unfinished hint', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    mockRunDeepResearch.mockResolvedValueOnce({
      finalReport: '## Ключевые выводы\nрынок растёт',
      finalizeReason: 'budget',
      usage: { input: 5, output: 5, total: 10 },
      findings: [{ round: 1, subQuestion: 'q', digest: 'd', sources: [], tokens: 10 }],
      errors: [],
    });

    await runNewDeepResearch(baseParams('изучи рынок CRM'));

    const msg = mockSavedMessages.find((m) => m.messageId === 'r1');
    expect(msg.files).toHaveLength(1);
    expect(msg.drKind).toBe('report');
    // Gathering really was cut short above a real report — here the hint tells the truth.
    expect(msg.unfinished).toBe(true);
  });
});

describe('runNewDeepResearch — user message persisted as a real user turn', () => {
  it('saves the user message with sender User + isCreatedByUser true and mirrors it in created/final events', async () => {
    const api = require('@librechat/api');
    mockStartSovereignSession.mockResolvedValue(null);

    await runNewDeepResearch(baseParams('изучи рынок CRM'));

    // DB copy: persisting the bare preliminary message stored isCreatedByUser:false
    // (schema default) with no sender — after a refetch the question rendered as a
    // nameless, avatar-less message and the analytics isCreatedByUser filter skipped it.
    const userMsg = mockSavedMessages.find((m) => m.messageId === 'um1');
    expect(userMsg).toMatchObject({
      sender: 'User',
      isCreatedByUser: true,
      conversationId: 'c1',
    });

    // Job-store copy (the abort path re-saves from it).
    const createdEvents = api.GenerationJobManager.emitChunk.mock.calls.filter(
      ([, chunk]) => chunk?.created === true,
    );
    expect(createdEvents).toHaveLength(1);
    expect(createdEvents[0][1].message).toMatchObject({ sender: 'User', isCreatedByUser: true });

    // Final event copy (replaces the client's optimistic message in the query cache).
    expect(mockEmitDone).toHaveBeenCalledTimes(1);
    const finalEvent = mockEmitDone.mock.calls[0][1];
    expect(finalEvent.requestMessage).toMatchObject({ sender: 'User', isCreatedByUser: true });
  });

  it('a clarify turn saves the user message with the same user-turn fields', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    mockClarifyContent = '{"action":"CLARIFY","questions":["Какой бюджет?"]}';
    const params = baseParams('посоветуй CRM');
    params.req.config.deepResearch = { clarify: true };

    await runNewDeepResearch(params);

    const userMsg = mockSavedMessages.find((m) => m.messageId === 'um1');
    expect(userMsg).toMatchObject({ sender: 'User', isCreatedByUser: true });
  });
});

describe('isDrFollowUp (badge-independent DR routing, drKind-gated — review r2)', () => {
  const models = require('~/models');
  const NO_PARENT = '00000000-0000-0000-0000-000000000000';

  it('is TRUE when the parent carries drKind=clarify', async () => {
    models.getMessages.mockResolvedValueOnce([
      { messageId: 'p1', isCreatedByUser: false, drKind: 'clarify' },
    ]);
    await expect(
      isDrFollowUp({ userId: 'u1', conversationId: 'c1', parentMessageId: 'p1' }),
    ).resolves.toBe(true);
    expect(models.getMessages).toHaveBeenCalledWith(
      { conversationId: 'c1', user: 'u1', messageId: 'p1' },
      'messageId isCreatedByUser drKind',
    );
  });

  it('is TRUE when the parent carries drKind=plan (task #21)', async () => {
    models.getMessages.mockResolvedValueOnce([
      { messageId: 'p1', isCreatedByUser: false, drKind: 'plan' },
    ]);
    await expect(
      isDrFollowUp({ userId: 'u1', conversationId: 'c1', parentMessageId: 'p1' }),
    ).resolves.toBe(true);
  });

  it('is TRUE when the parent carries drKind=aborted (re-plan after a Stop, task #21)', async () => {
    // A comment after a Stop must route back into DR so it re-plans the original plan.
    models.getMessages.mockResolvedValueOnce([
      { messageId: 'p1', isCreatedByUser: false, drKind: 'aborted' },
    ]);
    await expect(
      isDrFollowUp({ userId: 'u1', conversationId: 'c1', parentMessageId: 'p1' }),
    ).resolves.toBe(true);
  });

  it('is FALSE when the parent carries drKind=report (a finished report → normal chat)', async () => {
    // Owner decision (§5.2): a follow-up on a COMPLETED report is an ordinary chat turn,
    // NOT a re-plan. Only an aborted (Stopped) run routes back into planning.
    models.getMessages.mockResolvedValueOnce([
      { messageId: 'p1', isCreatedByUser: false, drKind: 'report' },
    ]);
    await expect(
      isDrFollowUp({ userId: 'u1', conversationId: 'c1', parentMessageId: 'p1' }),
    ).resolves.toBe(false);
  });

  it('is FALSE for MARKER-LOOKALIKE prose without drKind (the P0 collision fix)', async () => {
    // A normal-chat answer that merely STARTS with the plan-marker text must not route
    // its follow-up into a research run — provenance, not prose, decides.
    models.getMessages.mockResolvedValueOnce([
      {
        messageId: 'p1',
        isCreatedByUser: false,
        text: '**План исследования:** Рынок CRM\n\n1. Собрать\n2. Сравнить',
      },
    ]);
    await expect(
      isDrFollowUp({ userId: 'u1', conversationId: 'c1', parentMessageId: 'p1' }),
    ).resolves.toBe(false);
  });

  it('is FALSE for a normal parent, a user-authored parent, and a missing parent', async () => {
    models.getMessages.mockResolvedValueOnce([
      { messageId: 'p1', isCreatedByUser: false, text: '## Отчёт по CRM' },
    ]);
    await expect(
      isDrFollowUp({ userId: 'u1', conversationId: 'c1', parentMessageId: 'p1' }),
    ).resolves.toBe(false);

    models.getMessages.mockResolvedValueOnce([
      { messageId: 'p1', isCreatedByUser: true, drKind: 'plan' },
    ]);
    await expect(
      isDrFollowUp({ userId: 'u1', conversationId: 'c1', parentMessageId: 'p1' }),
    ).resolves.toBe(false);

    models.getMessages.mockResolvedValueOnce([]);
    await expect(
      isDrFollowUp({ userId: 'u1', conversationId: 'c1', parentMessageId: 'p1' }),
    ).resolves.toBe(false);
  });

  it('is FALSE without a real parent (first message) and never queries', async () => {
    await expect(
      isDrFollowUp({ userId: 'u1', conversationId: 'c1', parentMessageId: NO_PARENT }),
    ).resolves.toBe(false);
    await expect(
      isDrFollowUp({ userId: 'u1', conversationId: 'c1', parentMessageId: null }),
    ).resolves.toBe(false);
    expect(models.getMessages).not.toHaveBeenCalled();
  });

  it('fails CLOSED (false) on a lookup error', async () => {
    models.getMessages.mockRejectedValueOnce(new Error('mongo down'));
    await expect(
      isDrFollowUp({ userId: 'u1', conversationId: 'c1', parentMessageId: 'p1' }),
    ).resolves.toBe(false);
  });
});

describe('runNewDeepResearch — P0 review fixes (billing + abort signal)', () => {
  it('bills the clarify model call: a CLARIFY turn returns non-zero usage', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    mockClarifyContent = '{"action":"CLARIFY","questions":["Какой масштаб бизнеса?"]}';
    const params = baseParams('посоветуй CRM');
    params.req.config.deepResearch = { clarify: true };

    const result = await runNewDeepResearch(params);

    expect(result.finalizeReason).toBe('clarify');
    expect(result.usage.total).toBeGreaterThan(0);
  });

  it('bills the title model call on top of the engine usage', async () => {
    mockStartSovereignSession.mockResolvedValue(null);

    const result = await runNewDeepResearch(baseParams('изучи рынок CRM'));

    // The engine mock reports total=30; the title call's estimated usage lands on top.
    expect(result.usage.total).toBeGreaterThan(30);
  });

  it('threads the abort signal into the clarify and title model calls', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    mockClarifyContent = '{"action":"PROCEED","questions":[]}';
    const controller = new AbortController();
    const params = baseParams('изучи рынок CRM');
    params.req.config.deepResearch = { clarify: true };
    params.signal = controller.signal;

    await runNewDeepResearch(params);

    const signalled = mockInvokeOptions.filter((options) => options?.signal === controller.signal);
    expect(signalled.length).toBeGreaterThanOrEqual(2); // clarify + title
  });
});

describe('runNewDeepResearch — task #21 plan gate', () => {
  const models = require('~/models');

  function planParams(text, extra = {}) {
    const p = baseParams(text);
    p.req.config.deepResearch = { planGate: true, ...extra };
    return p;
  }

  it('fresh turn: emits a PLAN card and does NOT run the graph', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    mockPlanContent =
      '{"action":"PLAN","title":"Рынок CRM","steps":["Собрать вендоров","Сравнить цены","Сформировать таблицу и рекомендацию"]}';

    const result = await runNewDeepResearch(planParams('изучи CRM рынок'));

    expect(mockRunDeepResearch).not.toHaveBeenCalled();
    expect(result.finalizeReason).toBe('plan');
    const msg = mockSavedMessages.find((m) => m.messageId === 'r1');
    expect(msg.text).toContain('**План исследования:** Рынок CRM');
    expect(msg.text).toContain('1. Собрать вендоров');
    expect(msg.text).toContain('3. Сформировать таблицу и рекомендацию');
    expect(msg.unfinished).toBe(false);
  });

  it('fresh turn where the model PROCEEDs: runs the graph with no card', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    mockPlanContent = '{"action":"PROCEED"}';

    await runNewDeepResearch(planParams('сравни Битрикс24 и AmoCRM по цене за 2026 год'));

    expect(mockRunDeepResearch).toHaveBeenCalledTimes(1);
  });

  it('START on a plan parent: runs the graph without a second decision', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    models.getMessages.mockResolvedValueOnce([
      { messageId: 'orig', isCreatedByUser: true, parentMessageId: null, text: 'изучи CRM рынок' },
      {
        messageId: 'p1',
        isCreatedByUser: false,
        parentMessageId: 'orig',
        drKind: 'plan',
        text: '**План исследования:** Рынок CRM\n\n1. Собрать\n2. Сравнить',
      },
    ]);

    await runNewDeepResearch(planParams('Начать исследование'));

    expect(mockRunDeepResearch).toHaveBeenCalledTimes(1);
    // The graph researches the approved dialogue (original request survives), not the marker.
    const graphInput = mockRunDeepResearch.mock.calls[0][0].input.messages[0].content;
    expect(graphInput).toContain('изучи CRM рынок');
    expect(graphInput).not.toContain('Начать исследование');
    // Review r2: the START command message is stamped and persisted at admission.
    const userMsg = mockSavedMessages.find((m) => m.messageId === 'um1');
    expect(userMsg.drKind).toBe('start');
  });

  it('CANCEL on a plan parent: terminal cancelled message, no graph, no model calls', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    models.getMessages.mockResolvedValueOnce([
      { messageId: 'orig', isCreatedByUser: true, parentMessageId: null, text: 'изучи CRM' },
      {
        messageId: 'p1',
        isCreatedByUser: false,
        parentMessageId: 'orig',
        drKind: 'plan',
        text: '**План исследования:** Рынок CRM\n\n1. Собрать',
      },
    ]);

    const result = await runNewDeepResearch(planParams('Отменить исследование'));

    expect(result.finalizeReason).toBe('cancelled');
    expect(mockRunDeepResearch).not.toHaveBeenCalled();
    expect(mockInvokeArgs).toHaveLength(0); // no decision + no title model call
    // Review r2: cancel/duplicate short-circuit BEFORE the anonymizer — zero sessions.
    expect(mockStartSovereignSession).not.toHaveBeenCalled();
    const msg = mockSavedMessages.find((m) => m.messageId === 'r1');
    expect(msg.text).toBe('Исследование отменено.');
    expect(msg.unfinished).toBe(false);
    expect(msg.drKind).toBeUndefined();
    const userMsg = mockSavedMessages.find((m) => m.messageId === 'um1');
    expect(userMsg.drKind).toBe('cancel');
  });

  it('reply to a clarify prompt: produces a PLAN card and never asks a 2nd clarify', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    mockPlanContent =
      '{"action":"PLAN","title":"CRM для малого бизнеса","steps":["Собрать","Сравнить"]}';
    models.getMessages.mockResolvedValueOnce([
      { messageId: 'orig', isCreatedByUser: true, parentMessageId: null, text: 'посоветуй CRM' },
      {
        messageId: 'p1',
        isCreatedByUser: false,
        parentMessageId: 'orig',
        drKind: 'clarify',
        text: '**Уточните, пожалуйста, детали исследования:**\n1. Масштаб?',
      },
    ]);

    const result = await runNewDeepResearch(
      planParams('малый бизнес, 20 человек', { clarify: true }),
    );

    expect(result.finalizeReason).toBe('plan');
    expect(mockRunDeepResearch).not.toHaveBeenCalled();
  });

  it('Stop then a comment re-plans the ORIGINAL plan (plan-edit, not a fresh turn)', async () => {
    // The task #21 prod bug: after a Stop the follow-up landed as a FRESH turn (planned the
    // comment in isolation). With drKind='aborted' the comment now re-plans the original.
    mockStartSovereignSession.mockResolvedValue(null);
    mockPlanContent =
      '{"action":"PLAN","title":"Реранкеры для русского языка","steps":["Отобрать реранкеры с поддержкой русского","Сравнить на русских датасетах"]}';
    // Message tree after a Stop: original request → plan card → START → aborted anchor.
    models.getMessages.mockResolvedValueOnce([
      {
        messageId: 'orig',
        isCreatedByUser: true,
        parentMessageId: null,
        text: 'исследуй реранкеры',
      },
      {
        messageId: 'plan1',
        isCreatedByUser: false,
        parentMessageId: 'orig',
        drKind: 'plan',
        text: '**План исследования:** Реранкеры\n\n1. Отобрать\n2. Сравнить',
      },
      {
        messageId: 'start1',
        isCreatedByUser: true,
        parentMessageId: 'plan1',
        drKind: 'start',
        text: 'Начать исследование',
      },
      {
        messageId: 'ab1',
        isCreatedByUser: false,
        parentMessageId: 'start1',
        drKind: 'aborted',
        text: 'Исследование остановлено. Напишите, что изменить в плане, — и я пересоберу его с учётом ваших правок.',
      },
    ]);
    const params = planParams('с учётом русского языка');
    params.parentMessageId = 'ab1';

    const result = await runNewDeepResearch(params);

    // A new PLAN card (re-plan), NOT a research run.
    expect(result.finalizeReason).toBe('plan');
    expect(mockRunDeepResearch).not.toHaveBeenCalled();
    // The plan decision saw the ORIGINAL request AND the comment — not the comment alone.
    const decision = mockInvokeArgs.find(
      (msgs) =>
        typeof msgs?.[0]?.content === 'string' && msgs[0].content.includes('модуль ПЛАНИРОВАНИЯ'),
    );
    expect(decision).toBeDefined();
    expect(decision[1].content).toContain('исследуй реранкеры');
    expect(decision[1].content).toContain('с учётом русского языка');
    // A refinement never re-asks clarify (allowClarify off → the prompt carries the ban).
    expect(decision[0].content).toContain('CLARIFY запрещено');
    // Track 3: the decision runs in plan-edit refinement mode.
    expect(decision[0].content).toContain('РЕЖИМ ПРАВКИ ПЛАНА');
    // The aborted anchor's own notice text must NOT pollute the re-plan dialogue.
    expect(decision[1].content).not.toContain('Исследование остановлено');
    // The new card is stamped drKind='plan' and reflects the refinement.
    const card = mockSavedMessages.find((m) => m.messageId === 'r1');
    expect(card.drKind).toBe('plan');
    expect(card.text).toContain('русск');
  });

  it('a free-text comment on a live plan card (before start) re-plans in refinement mode', async () => {
    // The card-edit path (Редактировать → type a change → the plan rebuilds): same plan-edit
    // classification + refinement prompt as the post-Stop path, but the parent is the plan.
    mockStartSovereignSession.mockResolvedValue(null);
    mockPlanContent =
      '{"action":"PLAN","title":"CRM с упором на цену","steps":["Собрать вендоров","Сравнить цены за 2026"]}';
    models.getMessages.mockResolvedValueOnce([
      { messageId: 'orig', isCreatedByUser: true, parentMessageId: null, text: 'изучи CRM рынок' },
      {
        messageId: 'plan1',
        isCreatedByUser: false,
        parentMessageId: 'orig',
        drKind: 'plan',
        text: '**План исследования:** Рынок CRM\n\n1. Собрать\n2. Сравнить',
      },
    ]);
    const params = planParams('сделай упор на цену');
    params.parentMessageId = 'plan1';

    const result = await runNewDeepResearch(params);

    expect(result.finalizeReason).toBe('plan');
    expect(mockRunDeepResearch).not.toHaveBeenCalled();
    const decision = mockInvokeArgs.find(
      (msgs) =>
        typeof msgs?.[0]?.content === 'string' && msgs[0].content.includes('модуль ПЛАНИРОВАНИЯ'),
    );
    expect(decision[0].content).toContain('РЕЖИМ ПРАВКИ ПЛАНА');
    expect(decision[1].content).toContain('изучи CRM рынок');
    expect(decision[1].content).toContain('сделай упор на цену');
  });

  it('restores (de-masks) the plan card before saving', async () => {
    mockStartSovereignSession.mockResolvedValue({
      maskedQuestion: 'изучи рынок для [PERSON_1]',
      passthroughHeaders: {},
      maskContent: jest.fn(async (t) => t),
      restore: jest.fn(async (t) => t.replace('[PERSON_1]', 'Иван')),
      drop: jest.fn(async () => {}),
    });
    mockPlanContent = '{"action":"PLAN","title":"План для [PERSON_1]","steps":["Изучить рынок"]}';

    await runNewDeepResearch(planParams('изучи рынок для Ивана'));

    const msg = mockSavedMessages.find((m) => m.messageId === 'r1');
    expect(msg.text).toContain('Иван');
    expect(msg.text).not.toContain('[PERSON_1]');
  });

  it('emits dr_progress snapshots (plan steps + current action) during a START research run', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    models.getMessages.mockResolvedValueOnce([
      { messageId: 'orig', isCreatedByUser: true, parentMessageId: null, text: 'изучи CRM рынок' },
      {
        messageId: 'p1',
        isCreatedByUser: false,
        parentMessageId: 'orig',
        drKind: 'plan',
        text: '**План исследования:** Рынок CRM\n\n1. Собрать вендоров\n2. Сравнить цены',
      },
    ]);
    mockRunDeepResearch.mockImplementationOnce(async (params) => {
      params.onProgress({ type: 'scope', jurisdiction: 'RU' });
      params.onProgress({ type: 'research', round: 1, subQuestion: 'конкуренты 1ma в СНГ' });
      params.onProgress({ type: 'report' });
      return {
        finalReport: 'Отчёт',
        finalizeReason: 'completed',
        usage: { input: 1, output: 1, total: 2 },
        findings: [],
      };
    });

    await runNewDeepResearch(planParams('Начать исследование'));

    const drEvents = mockEmitChunk.mock.calls.filter((c) => c[1]?.event === 'dr_progress');
    // 1 pre-graph 'prepare' snapshot (round 23) + the 3 graph events
    expect(drEvents.length).toBe(4);
    expect(drEvents[0][1].data.phase).toBe('prepare');
    const research = drEvents.find((c) => c[1].data.phase === 'research');
    expect(research[1].data.action).toContain('конкуренты 1ma в СНГ');
    expect(research[1].data.steps).toEqual(['Собрать вендоров', 'Сравнить цены']);
    expect(research[1].data.searches).toBe(1);
    expect(research[1].data.progress).toBeGreaterThan(0);
    expect(research[1].data.progress).toBeLessThanOrEqual(1);
  });

  it('carries the approved plan into the graph and reports the step the run is on (r27)', async () => {
    /**
     * Two defects in one place (owner r27). The graph never SAW the plan — a run
     * was steered by the brief alone, so a plan the user edited changed nothing
     * about the research. And the card derived the highlighted step from the
     * progress fraction: `floor(0.40 × 3)` = 1, so the first research round
     * opened on step 2 with step 1 already ticked, under an action line about
     * something else. The supervisor now names the step and it travels here.
     */
    mockStartSovereignSession.mockResolvedValue(null);
    models.getMessages.mockResolvedValueOnce([
      { messageId: 'orig', isCreatedByUser: true, parentMessageId: null, text: 'погода в Сочи' },
      {
        messageId: 'p1',
        isCreatedByUser: false,
        parentMessageId: 'orig',
        drKind: 'plan',
        text: '**План исследования:** Погода\n\n1. Собрать нормы\n2. Сравнить температуры\n3. Свести таблицу',
      },
    ]);
    let seenConfigurable = null;
    mockRunDeepResearch.mockImplementationOnce(async (params) => {
      seenConfigurable = params.configurable;
      params.onProgress({ type: 'scope', jurisdiction: 'RU' });
      params.onProgress({ type: 'research', round: 1, subQuestion: 'нормы', planStep: 1 });
      params.onProgress({ type: 'research', round: 2, subQuestion: 'температуры', planStep: 2 });
      /* A round the model did not label, and one that points backwards: the
       * highlight must hold, never un-tick finished work. */
      params.onProgress({ type: 'research', round: 3, subQuestion: 'ещё' });
      params.onProgress({ type: 'research', round: 4, subQuestion: 'назад', planStep: 1 });
      params.onProgress({ type: 'report' });
      return {
        finalReport: 'Отчёт',
        finalizeReason: 'completed',
        usage: { input: 1, output: 1, total: 2 },
        findings: [],
      };
    });

    await runNewDeepResearch(planParams('Начать исследование'));

    expect(seenConfigurable.planSteps).toEqual([
      'Собрать нормы',
      'Сравнить температуры',
      'Свести таблицу',
    ]);
    const steps = mockEmitChunk.mock.calls
      .filter((c) => c[1]?.event === 'dr_progress' && c[1].data.steps.length > 0)
      .map((c) => [c[1].data.phase, c[1].data.stepIndex]);
    expect(steps).toEqual([
      ['scope', 0],
      ['research', 0],
      ['research', 1],
      ['research', 1],
      ['research', 1],
      ['report', 2],
    ]);
  });

  describe('the plan the GRAPH sees is masked in sovereign mode (r27)', () => {
    const planTree = () => [
      { messageId: 'orig', isCreatedByUser: true, parentMessageId: null, text: 'изучи для Ивана' },
      {
        messageId: 'p1',
        isCreatedByUser: false,
        parentMessageId: 'orig',
        drKind: 'plan',
        text: '**План исследования:** Рынок\n\n1. Собрать данные по Иванову Ивану\n2. Сравнить цены',
      },
    ];
    const runOnce = async () => {
      let seen = null;
      mockRunDeepResearch.mockImplementationOnce(async (params) => {
        seen = params.configurable;
        params.onProgress({ type: 'research', round: 1, subQuestion: 'q', planStep: 1 });
        return {
          finalReport: 'Отчёт',
          finalizeReason: 'completed',
          usage: { input: 1, output: 1, total: 2 },
          findings: [],
        };
      });
      await runNewDeepResearch(planParams('Начать исследование'));
      return seen;
    };

    it('FAILS ON PRE-FIX CODE: the graph gets placeholders, the user card keeps the names', async () => {
      /* The plan message is stored DE-MASKED — the user reads their own names —
       * so handing `planSteps` to the supervisor as-is egresses exactly what
       * Track B exists to stop, in the one place a plan echoes the request. */
      models.getMessages.mockResolvedValueOnce(planTree());
      mockStartSovereignSession.mockResolvedValue({
        maskedQuestion: 'изучи для [PERSON_1]',
        passthroughHeaders: {},
        maskContent: jest.fn(async (t) => t.replace(/Иванову Ивану/g, '[PERSON_1]')),
        restore: jest.fn(async (t) => t),
        drop: jest.fn(async () => {}),
      });

      const configurable = await runOnce();

      expect(configurable.planSteps).toEqual(['Собрать данные по [PERSON_1]', 'Сравнить цены']);
      expect(JSON.stringify(configurable.planSteps)).not.toContain('Иванову');
      /* The card the USER looks at keeps the real names. */
      const research = mockEmitChunk.mock.calls.find(
        (c) => c[1]?.event === 'dr_progress' && c[1].data.phase === 'research',
      );
      expect(research[1].data.steps).toEqual(['Собрать данные по Иванову Ивану', 'Сравнить цены']);
    });

    it('a masking failure drops the agenda rather than sending raw PII', async () => {
      models.getMessages.mockResolvedValueOnce(planTree());
      mockStartSovereignSession.mockResolvedValue({
        maskedQuestion: 'изучи для [PERSON_1]',
        passthroughHeaders: {},
        maskContent: jest.fn(async () => {
          throw new Error('anonymizer down');
        }),
        restore: jest.fn(async (t) => t),
        drop: jest.fn(async () => {}),
      });

      const configurable = await runOnce();

      expect(configurable.planSteps).toEqual([]);
      /* And the card is told NOTHING rather than left holding step 1: with no
       * agenda the run can never name a step, so a highlight would be a claim
       * nobody made. */
      const research = mockEmitChunk.mock.calls.find(
        (c) => c[1]?.event === 'dr_progress' && c[1].data.phase === 'research',
      );
      expect(research[1].data.steps.length).toBe(2);
      expect(research[1].data.stepIndex).toBeUndefined();
    });

    it('a masking that changed the line count drops the agenda — the mapping is unknown', async () => {
      models.getMessages.mockResolvedValueOnce(planTree());
      mockStartSovereignSession.mockResolvedValue({
        maskedQuestion: 'изучи для [PERSON_1]',
        passthroughHeaders: {},
        maskContent: jest.fn(async (t) => `${t}\nлишняя строка`),
        restore: jest.fn(async (t) => t),
        drop: jest.fn(async () => {}),
      });

      const configurable = await runOnce();

      expect(configurable.planSteps).toEqual([]);
    });
  });

  it('a PROCEED run reports no step at all — there is no plan to be on (r27)', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    mockPlanContent = '{"action":"PROCEED"}';
    mockRunDeepResearch.mockImplementationOnce(async (params) => {
      params.onProgress({ type: 'research', round: 1, subQuestion: 'q' });
      return {
        finalReport: 'Отчёт',
        finalizeReason: 'completed',
        usage: { input: 1, output: 1, total: 2 },
        findings: [],
      };
    });

    await runNewDeepResearch(planParams('изучи CRM рынок'));

    const research = mockEmitChunk.mock.calls.find(
      (c) => c[1]?.event === 'dr_progress' && c[1].data.phase === 'research',
    );
    expect(research[1].data.steps).toEqual([]);
    expect(research[1].data.stepIndex).toBeUndefined();
  });

  it('labels the pre-plan silence: prepare right after created, plan before the decision (round 23)', async () => {
    // A fresh gated turn that ends at the plan card: the graph never runs, yet the
    // client must see the wait labeled. Red on pre-fix code: no dr_progress existed
    // before the plan card (DR_REPAIR_Plan §1 root cause).
    mockStartSovereignSession.mockResolvedValue(null);
    mockPlanContent = '{"action":"PLAN","title":"Рынок CRM","steps":["Собрать вендоров"]}';

    await runNewDeepResearch(planParams('изучи CRM рынок'));

    expect(mockRunDeepResearch).not.toHaveBeenCalled();
    const drEvents = mockEmitChunk.mock.calls.filter((c) => c[1]?.event === 'dr_progress');
    const phases = drEvents.map((c) => c[1].data.phase);
    expect(phases).toEqual(['prepare', 'plan']);
    const createdIdx = mockEmitChunk.mock.calls.findIndex((c) => c[1]?.created === true);
    const prepareIdx = mockEmitChunk.mock.calls.findIndex(
      (c) => c[1]?.event === 'dr_progress' && c[1].data.phase === 'prepare',
    );
    expect(createdIdx).toBeGreaterThanOrEqual(0);
    expect(prepareIdx).toBeGreaterThan(createdIdx);
  });

  it('emits NO dr_progress when the plan gate is off (legacy runs are not spammed)', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    mockRunDeepResearch.mockImplementationOnce(async (params) => {
      params.onProgress({ type: 'scope' });
      params.onProgress({ type: 'research', round: 1, subQuestion: 'q' });
      return {
        finalReport: 'Отчёт',
        finalizeReason: 'completed',
        usage: { input: 1, output: 1, total: 2 },
        findings: [],
      };
    });
    const p = baseParams('изучи CRM'); // baseParams: deepResearch.clarify=false, no planGate

    await runNewDeepResearch(p);

    const drEvents = mockEmitChunk.mock.calls.filter((c) => c[1]?.event === 'dr_progress');
    expect(drEvents).toHaveLength(0);
  });

  /**
   * The report node is a single long completion — three to four minutes on a deep run,
   * during which the graph used to say nothing at all. The card spent those minutes
   * showing the LAST sub-question at a bar that never moved: not idle, wrong.
   */
  function planChain() {
    return [
      { messageId: 'orig', isCreatedByUser: true, parentMessageId: null, text: 'изучи CRM рынок' },
      {
        messageId: 'p1',
        isCreatedByUser: false,
        parentMessageId: 'orig',
        drKind: 'plan',
        text: '**План исследования:** Рынок CRM\n\n1. Собрать вендоров\n2. Сравнить цены',
      },
    ];
  }

  function graphRun(script) {
    mockRunDeepResearch.mockImplementationOnce(async (params) => {
      script(params);
      return {
        finalReport: 'Отчёт',
        finalizeReason: 'completed',
        usage: { input: 1, output: 1, total: 2 },
        findings: [],
      };
    });
  }

  const reportSnapshots = () =>
    mockEmitChunk.mock.calls
      .filter((c) => c[1]?.event === 'dr_progress' && c[1].data.phase === 'report')
      .map((c) => c[1].data);

  it('keeps a heartbeat for the whole time the report is being written', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    models.getMessages.mockResolvedValueOnce(planChain());
    jest.useFakeTimers();
    try {
      graphRun((params) => {
        params.onProgress({ type: 'research', round: 1, subQuestion: 'конкуренты' });
        // The engine announces the phase from the supervisor's concluding pass.
        params.onProgress({ type: 'report' });
        // Advanced in slices, not one leap: a single long jump can hide a handler that
        // only ever runs once.
        for (let i = 0; i < 14; i++) {
          jest.advanceTimersByTime(5_000);
        }
      });
      await runNewDeepResearch(planParams('Начать исследование'));
    } finally {
      jest.useRealTimers();
    }

    const snapshots = reportSnapshots();
    // FAILS ON PRE-FIX CODE: one snapshot, then silence for the rest of the phase.
    expect(snapshots.length).toBeGreaterThanOrEqual(14);
    expect(snapshots[snapshots.length - 1].progress).toBeGreaterThan(snapshots[0].progress);
    expect(snapshots[snapshots.length - 1].action).toMatch(/Формирует отчёт — \d+ мин \d+ с/);
    // The client REPLACES its snapshot, so every tick has to carry the checklist and the
    // search count too — a partial one would blank the card it is trying to animate.
    expect(snapshots[0].steps).toEqual(['Собрать вендоров', 'Сравнить цены']);
    expect(snapshots[0].searches).toBe(1);
  });

  it('stops the heartbeat when the run ends', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    models.getMessages.mockResolvedValueOnce(planChain());
    jest.useFakeTimers();
    let after = 0;
    try {
      graphRun((params) => {
        params.onProgress({ type: 'report' });
        jest.advanceTimersByTime(10_000);
      });
      await runNewDeepResearch(planParams('Начать исследование'));
      const during = reportSnapshots().length;
      // A timer that outlives the run keeps emitting into a stream the client has already
      // finalized — the card would flicker back to life under the finished report.
      jest.advanceTimersByTime(60_000);
      after = reportSnapshots().length - during;
    } finally {
      jest.useRealTimers();
    }
    expect(after).toBe(0);
  });

  it('the second report event does not restart the clock', async () => {
    // The engine fires 'report' twice by design: the supervisor's conclusion (the phase
    // starts) and the report node's own update (it is over). Restarting on the second
    // would walk the bar back to its opening number on the last tick before the final.
    mockStartSovereignSession.mockResolvedValue(null);
    models.getMessages.mockResolvedValueOnce(planChain());
    jest.useFakeTimers();
    try {
      graphRun((params) => {
        params.onProgress({ type: 'report' });
        jest.advanceTimersByTime(120_000);
        params.onProgress({ type: 'report' });
      });
      await runNewDeepResearch(planParams('Начать исследование'));
    } finally {
      jest.useRealTimers();
    }
    const snapshots = reportSnapshots();
    const last = snapshots[snapshots.length - 1];
    const previous = snapshots[snapshots.length - 2];
    expect(last.progress).toBeGreaterThanOrEqual(previous.progress);
    expect(last.progress).toBeGreaterThan(0.92);
  });

  it('arms no heartbeat on a legacy run with no card listening', async () => {
    // The gate lives in the emit, so a timer here would tick for four minutes into a
    // function that discards every tick. Observable only as a pending timer.
    mockStartSovereignSession.mockResolvedValue(null);
    jest.useFakeTimers();
    let armed = -1;
    try {
      mockRunDeepResearch.mockImplementationOnce(async (params) => {
        const before = jest.getTimerCount();
        params.onProgress({ type: 'report' });
        armed = jest.getTimerCount() - before;
        return {
          finalReport: 'Отчёт',
          finalizeReason: 'completed',
          usage: { input: 1, output: 1, total: 2 },
          findings: [],
        };
      });
      await runNewDeepResearch(baseParams('изучи CRM')); // no planGate
    } finally {
      jest.useRealTimers();
    }
    expect(armed).toBe(0);
  });

  it('never asks the engine for token streaming', async () => {
    // Not an omission — a measured dead end. Every DR node model is built
    // `streaming: false` on purpose (see the non-streaming test above), so the token
    // callback delivers the whole report in ONE burst after the node is already done.
    // A length-of-text signal looks perfect against a streaming fake and does nothing on
    // the stand.
    mockStartSovereignSession.mockResolvedValue(null);
    models.getMessages.mockResolvedValueOnce(planChain());
    graphRun(() => {});

    await runNewDeepResearch(planParams('Начать исследование'));

    expect(mockRunDeepResearch.mock.calls[0][0].onToken).toBeUndefined();
  });
});

describe('runNewDeepResearch — task #21 aborted anchor (persist a re-plannable Stop)', () => {
  it('a Stop with NO findings saves the clean STOPPED anchor, IGNORING the non-empty fallback report', async () => {
    // runDeepResearch NEVER returns a blank finalReport — an aborted run with nothing
    // collected still carries the fallback notice. The runner must IGNORE that text
    // outright: a Stop is keyed on the reason alone, never on the report being blank (which
    // it never is) nor on findings. This case and its WITH-findings sibling below pin BOTH
    // sides of that, so no findings-keyed branch can creep back in.
    mockStartSovereignSession.mockResolvedValue(null);
    mockRunDeepResearch.mockResolvedValueOnce({
      // Deliberately plan-bearing text, so the assertions below have teeth: whatever the
      // graph hands back, none of it may reach the saved Stop message.
      finalReport: 'Аналитическая записка\n\n**План исследования:** Рынок CRM\n\nДанных нет.',
      finalizeReason: 'aborted',
      usage: { input: 5, output: 0, total: 5 },
      findings: [],
    });

    const result = await runNewDeepResearch(baseParams('изучи рынок CRM'));

    expect(result.finalizeReason).toBe('aborted');
    const msg = mockSavedMessages.find((m) => m.messageId === 'r1');
    expect(msg).toBeDefined();
    expect(msg.drKind).toBe('aborted');
    expect(msg.text).toContain('Исследование остановлено');
    // The useless fallback (the "Частичный отчёт" echoing the plan) must NOT be saved.
    expect(msg.text).not.toContain('Частичный отчёт');
    expect(msg.text).not.toContain('План исследования');
    // A complete terminal notice (like a cancel) — NOT flagged unfinished, so no redundant
    // "unfinished message" indicator renders under an explicit stop notice.
    expect(msg.unfinished).toBe(false);
  });

  it('a Stop WITH collected findings STILL saves only the clean STOPPED notice (owner: Stop = nothing)', async () => {
    // Owner decision 2026-07-13: a Stop is "I don't want this" — it never yields a report,
    // even if findings were gathered. No partial banner, no findings dump; just STOPPED.
    mockStartSovereignSession.mockResolvedValue(null);
    mockRunDeepResearch.mockResolvedValueOnce({
      finalReport: 'Промежуточные данные по вендорам',
      finalizeReason: 'aborted',
      usage: { input: 5, output: 5, total: 10 },
      findings: [{ subQuestion: 'вендоры CRM', digest: '...', sources: [] }],
    });

    await runNewDeepResearch(baseParams('изучи рынок CRM'));

    const msg = mockSavedMessages.find((m) => m.messageId === 'r1');
    expect(msg.drKind).toBe('aborted');
    expect(msg.text).toContain('Исследование остановлено');
    expect(msg.text).not.toContain('Частичный отчёт');
    // A clean terminal notice — not an unfinished generation.
    expect(msg.unfinished).toBe(false);
  });

  it('a budget-limit partial stays drKind=report (a valid answer → normal chat, not re-plan)', async () => {
    // Owner decision (§5.2): only a user Stop routes back into planning. A budget/time/
    // rounds partial is a valid, if truncated, report — its follow-up is ordinary chat.
    mockStartSovereignSession.mockResolvedValue(null);
    mockRunDeepResearch.mockResolvedValueOnce({
      finalReport: 'Отчёт, оборванный по лимиту бюджета',
      finalizeReason: 'budget',
      usage: { input: 5, output: 5, total: 10 },
      findings: [],
    });

    await runNewDeepResearch(baseParams('изучи рынок CRM'));

    const msg = mockSavedMessages.find((m) => m.messageId === 'r1');
    expect(msg.drKind).toBe('report');
  });
});

describe('runNewDeepResearch — review r2 hardening', () => {
  const models = require('~/models');

  function planParams(text, extra = {}) {
    const p = baseParams(text);
    p.req.config.deepResearch = { planGate: true, ...extra };
    return p;
  }

  /** Plan parent + original request; `children` appends extra siblings under the plan. */
  function planChain(children = []) {
    return [
      { messageId: 'orig', isCreatedByUser: true, parentMessageId: null, text: 'изучи CRM рынок' },
      {
        messageId: 'p1',
        isCreatedByUser: false,
        parentMessageId: 'orig',
        drKind: 'plan',
        text: '**План исследования:** Рынок CRM\n\n1. Собрать\n2. Сравнить',
      },
      ...children,
    ];
  }

  it('refuses a DUPLICATE START (another tab already launched this plan): no graph, no session', async () => {
    models.getMessages.mockResolvedValueOnce(
      planChain([
        {
          messageId: 'other-start',
          isCreatedByUser: true,
          parentMessageId: 'p1',
          drKind: 'start',
          text: 'Начать исследование',
        },
      ]),
    );

    const result = await runNewDeepResearch(planParams('Начать исследование'));

    expect(result.finalizeReason).toBe('limit');
    expect(mockRunDeepResearch).not.toHaveBeenCalled();
    expect(mockStartSovereignSession).not.toHaveBeenCalled();
    const msg = mockSavedMessages.find((m) => m.messageId === 'r1');
    expect(msg.text).toContain('уже запущено');
    expect(msg.drKind).toBeUndefined();
  });

  it('a DUPLICATE START skips the caps: gets the duplicate notice even when the server is saturated', async () => {
    const api = require('@librechat/api');
    models.getMessages.mockResolvedValueOnce(
      planChain([
        {
          messageId: 'other-start',
          isCreatedByUser: true,
          parentMessageId: 'p1',
          drKind: 'start',
          text: 'Начать исследование',
        },
      ]),
    );

    const result = await runNewDeepResearch(planParams('Начать исследование'));

    expect(result.finalizeReason).toBe('limit');
    const msg = mockSavedMessages.find((m) => m.messageId === 'r1');
    // The duplicate notice, NOT the global-cap "сервис загружен" — a model-free terminal
    // is never subject to the concurrency caps, so the global scan is never even paid for.
    expect(msg.text).toContain('уже запущено');
    expect(msg.text).not.toContain('сервис загружен');
    expect(api.GenerationJobManager.getActiveDeepResearchCount).not.toHaveBeenCalled();
  });

  it('does NOT count the CURRENT message as its own duplicate (regenerate reuses the START id)', async () => {
    models.getMessages.mockResolvedValueOnce(
      planChain([
        {
          messageId: 'um1', // === baseParams userMessage.messageId → the regenerated turn itself
          isCreatedByUser: true,
          parentMessageId: 'p1',
          drKind: 'start',
          text: 'Начать исследование',
        },
      ]),
    );

    await runNewDeepResearch(planParams('Начать исследование'));

    expect(mockRunDeepResearch).toHaveBeenCalledTimes(1);
  });

  it('ROLLBACK safety: planGate OFF still honors START on a plan parent (researches the dialogue, not the marker)', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    models.getMessages.mockResolvedValueOnce(planChain());
    const p = baseParams('Начать исследование'); // no planGate, clarify:false

    await runNewDeepResearch(p);

    expect(mockRunDeepResearch).toHaveBeenCalledTimes(1);
    const graphInput = mockRunDeepResearch.mock.calls[0][0].input.messages[0].content;
    expect(graphInput).toContain('изучи CRM рынок');
    expect(graphInput).not.toContain('Начать исследование');
  });

  it('ROLLBACK safety: planGate OFF still honors CANCEL on a plan parent (terminal, free)', async () => {
    models.getMessages.mockResolvedValueOnce(planChain());
    const p = baseParams('Отменить исследование');

    const result = await runNewDeepResearch(p);

    expect(result.finalizeReason).toBe('cancelled');
    expect(mockRunDeepResearch).not.toHaveBeenCalled();
  });

  it('fails CLOSED to a fallback PLAN card when the decision model errors (gate survives outages)', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    mockTitleThrows = true; // every model.invoke throws → decision error path

    const result = await runNewDeepResearch(planParams('изучи CRM рынок'));

    expect(result.finalizeReason).toBe('plan');
    expect(mockRunDeepResearch).not.toHaveBeenCalled();
    const msg = mockSavedMessages.find((m) => m.messageId === 'r1');
    expect(msg.text).toContain('**План исследования:**');
    expect(msg.text).toContain('1. Собрать и изучить источники по теме запроса');
    expect(msg.drKind).toBe('plan');
  });

  it('a Stop during the plan decision emits the final itself, as the abort contract requires', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    mockTitleThrows = true; // the invoke throws; the aborted signal marks it a user Stop
    const p = planParams('изучи CRM рынок');
    p.signal = { aborted: true };

    const result = await runNewDeepResearch(p);

    expect(result.finalizeReason).toBe('aborted');
    expect(mockRunDeepResearch).not.toHaveBeenCalled();
    /** `producerFinalizesOnAbort` means abortJob emits nothing and waits for THIS emit;
     *  returning early left the client spinning until the reaper (live: "Gave up after
     *  14865ms waiting for … to finalize"). */
    expect(mockEmitDone).toHaveBeenCalled();
    const msg = mockSavedMessages.find((m) => m.messageId === 'r1');
    expect(msg.text).toContain('Исследование остановлено');
    expect(msg.drKind).toBe('aborted');
  });

  it('title-once: an already-titled conversation makes ZERO title model calls and reuses the title', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    models.getConvo.mockResolvedValueOnce({ conversationId: 'c1', title: 'Рынок CRM в СНГ' });
    models.getMessages.mockResolvedValueOnce(planChain());

    await runNewDeepResearch(planParams('Начать исследование'));

    // START skips the decision; with the title reused, NO model.invoke happens at all.
    expect(mockInvokeArgs).toHaveLength(0);
    const finalEvent = mockEmitDone.mock.calls[0][1];
    expect(finalEvent.title).toBe('Рынок CRM в СНГ');
  });

  it('stamps drKind on the runner messages: plan card → plan, completed report → report', async () => {
    mockStartSovereignSession.mockResolvedValue(null);

    await runNewDeepResearch(planParams('изучи CRM рынок'));
    const planMsg = mockSavedMessages.find((m) => m.messageId === 'r1');
    expect(planMsg.drKind).toBe('plan');

    mockSavedMessages.length = 0;
    models.getMessages.mockResolvedValueOnce(planChain());
    await runNewDeepResearch(planParams('Начать исследование'));
    const reportMsg = mockSavedMessages.find((m) => m.messageId === 'r1');
    expect(reportMsg.drKind).toBe('report');
  });

  it('skips the final emit when the job was REPLACED mid-run (stale-job guard parity)', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    models.getMessages.mockResolvedValueOnce(planChain());
    mockGetJob.mockResolvedValueOnce({ streamId: 'stream-1', createdAt: 999 });
    const p = planParams('▶ Начать исследование');
    p.jobCreatedAt = 1;

    await runNewDeepResearch(p);

    expect(mockEmitDone).not.toHaveBeenCalled();
    expect(mockCompleteJob).not.toHaveBeenCalled();
    // The report itself is still persisted — nothing is lost, only the stale emit.
    expect(mockSavedMessages.find((m) => m.messageId === 'r1')).toBeDefined();
  });

  it('accepts a precomputed turn (request.js classification) and skips its own conversation load', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    const p = planParams('✕ Отменить исследование');
    p.turn = {
      kind: 'plan-cancel',
      dialogue: null,
      originalRequest: 'изучи CRM рынок',
      parentText: '**План исследования:** Рынок CRM',
      duplicateStart: false,
    };

    const result = await runNewDeepResearch(p);

    expect(result.finalizeReason).toBe('cancelled');
    expect(models.getMessages).not.toHaveBeenCalled();
  });
});

describe('runNewDeepResearch — spend attribution (x-librechat-user-id)', () => {
  /** Build params whose req carries a real user id, so the header can resolve to it. */
  const attributedParams = (text, userId) => {
    const p = baseParams(text);
    return { ...p, req: { ...p.req, user: { id: userId, role: 'user' } } };
  };

  beforeEach(() => {
    mockStartSovereignSession.mockResolvedValue(null);
    mockInitializeCustom.mockResolvedValue({
      llmConfig: { apiKey: 'sk-client', provider: 'openAI' },
      configOptions: {
        baseURL: 'http://anon.internal:8000/v1',
        // The live `1ma` endpoint ships this placeholder header; the anonymizer forwards
        // the resolved id to the credit ledger to attribute the spend.
        defaultHeaders: { 'x-librechat-user-id': '{{LIBRECHAT_USER_ID}}' },
      },
      provider: 'openAI',
    });
  });

  it('resolves the placeholder to the real user id on every model the run builds', async () => {
    await runNewDeepResearch(attributedParams('изучи рынок CRM', 'user-abc-123'));

    expect(mockModelCtorArgs.length).toBeGreaterThanOrEqual(1);
    for (const opts of mockModelCtorArgs) {
      expect(opts.configuration.defaultHeaders['x-librechat-user-id']).toBe('user-abc-123');
      expect(opts.configuration.defaultHeaders['x-librechat-user-id']).not.toContain('{{');
    }
  });
});

describe('runNewDeepResearch — node models are non-streaming', () => {
  it('never builds a streaming model, so no run pays for LangChain token estimation', async () => {
    await runNewDeepResearch(baseParams('изучи рынок CRM'));

    expect(mockModelCtorArgs.length).toBeGreaterThanOrEqual(1);
    for (const opts of mockModelCtorArgs) {
      expect(opts.streaming).toBe(false);
    }
  });
});

describe('runNewDeepResearch — a research chat stays in its Project', () => {
  const models = require('~/models');

  it('files the new conversation under the project the request came from', async () => {
    const p = baseParams('изучи рынок CRM');
    p.req.body = { project_id: 'proj-42' };

    await runNewDeepResearch(p);

    const [, fields] = models.saveConvo.mock.calls.at(-1);
    expect(fields.project_id).toBe('proj-42');
  });

  it('writes no project field for a chat outside any project', async () => {
    await runNewDeepResearch(baseParams('изучи рынок CRM'));

    const [, fields] = models.saveConvo.mock.calls.at(-1);
    expect(fields).not.toHaveProperty('project_id');
  });

  /**
   * The FOUNDING CASE, asserted the way it actually failed rather than by field name.
   *
   * A custom endpoint's name ('1ma' here, as on the stand) is not a schema key, so anything
   * that parses a conversation's settings resolves it through `endpointType`. With the field
   * missing `parseConvo` throws `Unknown endpoint: 1ma` — which is exactly how Export died:
   * json/txt/markdown build an options block from the parsed conversation, csv and the
   * screenshot do not, so those two kept working and the failure read as "the button does
   * nothing". Measured on the stand before the fix: 42 of 42 conversations missing
   * `endpointType` were DR ones, 0 of 128 others.
   */
  it('persists a conversation whose settings still parse (the Export failure)', async () => {
    const { parseConvo } = require('librechat-data-provider');
    const p = baseParams('изучи рынок CRM');
    p.endpointType = 'custom';

    await runNewDeepResearch(p);

    const [, fields] = models.saveConvo.mock.calls.at(-1);
    expect(fields.endpoint).toBe('1ma');
    /* The VALUE, not just parseability: 'google' would also parse cleanly and quietly
     * describe the chat as something it is not. */
    expect(fields.endpointType).toBe('custom');
    expect(() =>
      parseConvo({
        endpoint: fields.endpoint,
        endpointType: fields.endpointType,
        conversation: fields,
      }),
    ).not.toThrow();
  });

  it('writes no endpointType when the request carries none', async () => {
    await runNewDeepResearch(baseParams('изучи рынок CRM'));

    const [, fields] = models.saveConvo.mock.calls.at(-1);
    expect(fields).not.toHaveProperty('endpointType');
  });
});

/**
 * Provider routing (`deepResearch.modes.<tier>.provider`) must reach the WIRE.
 *
 * Deep Research builds its own model clients and never saw the model spec's `addParams`,
 * so every DR call went out unpinned and OpenRouter picked the platform — measured on the
 * stand, the first live call to `deepseek-v4-pro-0813` was served fp8-quantised. The
 * resolver's own contract is covered in packages/api/.../modes.spec.ts; what only this
 * test can prove is that the resolved value lands in the model constructor's `modelKwargs`,
 * which is what LangChain spreads into the request body. Asserting on the config object
 * alone would pass with the wiring cut.
 */
describe("runNewDeepResearch — the run is billed at the ENDPOINT's rates", () => {
  /**
   * Without the endpoint's own price table, `getMultiplier` falls back to the family-wide
   * one in data-schemas: 0.28/0.42 for every `deepseek`, 0.8/2.4 for every `claude-`.
   * Measured on the stand, that understated a v4-pro-0813 run ~3x and the deep tier's
   * Opus 5 by 6-10x. The chat path had passed this config all along; DR never did, so a
   * price table written in librechat.yaml looked applied and silently was not.
   */
  const { recordCollectedUsage } = require('@librechat/api');

  it("hands recordCollectedUsage the endpoint's tokenConfig", async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    mockInitializeCustom.mockImplementation(async () => ({
      llmConfig: { apiKey: 'k' },
      configOptions: { baseURL: 'http://anonymizer:8000/v1' },
      provider: 'openAI',
      endpointTokenConfig: { 'vendor/lead-x': { prompt: 1.32, completion: 3.96 } },
    }));

    await runNewDeepResearch(baseParams('изучи рынок CRM'));

    const billed = recordCollectedUsage.mock.calls.find((c) => c[1]?.context === 'deep_research');
    expect(billed).toBeDefined();
    expect(billed[1].endpointTokenConfig).toEqual({
      'vendor/lead-x': { prompt: 1.32, completion: 3.96 },
    });
  });

  /**
   * The title (and clarify, and plan) are real lead-model calls made OUTSIDE the graph, and
   * their tokens are added to the run's aggregate. Adding them there but not to the split
   * makes the two disagree — at which point `buildDeepResearchCollectedUsage` rightly
   * discards the split and bills everything at the lead's rate again, silently undoing the
   * whole change. Found exactly that way; this keeps it found.
   */
  it('bills the graph and the out-of-graph calls under their own models, not all under the lead', async () => {
    mockStartSovereignSession.mockResolvedValue(null);

    // Clarify is the deterministic out-of-graph lead call in this harness (the title one
    // depends on whether the conversation already has a title).
    const params = baseParams('изучи рынок CRM');
    params.req.config.deepResearch.clarify = true;
    mockClarifyContent = '{"action":"PROCEED","questions":[]}';

    await runNewDeepResearch(params);

    const billed = recordCollectedUsage.mock.calls.find((c) => c[1]?.context === 'deep_research');
    const models = billed[1].collectedUsage.map((e) => e.model).sort();
    expect(models).toEqual(['lead-model', 'vendor/worker-x']);
    // The worker's tokens stay the worker's — they are not folded into the lead's entry.
    const worker = billed[1].collectedUsage.find((e) => e.model === 'vendor/worker-x');
    expect(worker).toEqual({ model: 'vendor/worker-x', input_tokens: 10, output_tokens: 20 });
  });

  /**
   * The opposite direction: when the split does NOT account for everything the run spent,
   * billing must charge the run's own total under the lead rather than the short split.
   * Under-billing silently is the failure mode that would never surface.
   */
  it('falls back to the aggregate when the engine reports a split that misses tokens', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    mockRunDeepResearch.mockResolvedValue({
      finalReport: REPORT,
      finalizeReason: 'completed',
      usage: { input: 1000, output: 2000, total: 3000 },
      usageByModel: { 'vendor/worker-x': { input: 10, output: 20, total: 30, estimated: 0 } },
      findings: [],
    });

    await runNewDeepResearch(baseParams('изучи рынок CRM'));

    const billed = recordCollectedUsage.mock.calls.find((c) => c[1]?.context === 'deep_research');
    expect(billed[1].collectedUsage).toHaveLength(1);
    expect(billed[1].collectedUsage[0].model).toBe('lead-model');
    expect(billed[1].collectedUsage[0].input_tokens).toBeGreaterThanOrEqual(1000);
  });

  it('bills anyway when the endpoint declares no prices — the old fallback stands', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    mockInitializeCustom.mockImplementation(async () => ({
      llmConfig: { apiKey: 'k' },
      configOptions: { baseURL: 'http://anonymizer:8000/v1' },
      provider: 'openAI',
    }));

    await runNewDeepResearch(baseParams('изучи рынок CRM'));

    const billed = recordCollectedUsage.mock.calls.find((c) => c[1]?.context === 'deep_research');
    expect(billed).toBeDefined();
    expect(billed[1].endpointTokenConfig).toBeUndefined();
  });
});

describe('runNewDeepResearch — OpenRouter provider pin reaches the model', () => {
  const { resolveDeepResearchTier } = require('@librechat/api');
  const BASE_TIER = { name: 'balanced', wallClockMinutes: 10 };
  const PIN = { order: ['DeepInfra', 'Fireworks', 'Together'], allow_fallbacks: false };

  afterEach(() => {
    resolveDeepResearchTier.mockReturnValue(BASE_TIER);
  });

  it("sends the tier's pin as modelKwargs.provider on EVERY graph model", async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    resolveDeepResearchTier.mockReturnValue({ ...BASE_TIER, provider: PIN });

    await runNewDeepResearch(baseParams('изучи рынок CRM'));

    // Lead, worker, compress and report are built through the same factory; a pin that
    // only reached some of them would still leak the others onto an arbitrary platform.
    expect(mockModelCtorArgs.length).toBeGreaterThan(0);
    for (const args of mockModelCtorArgs) {
      expect(args.modelKwargs?.provider).toEqual(PIN);
    }
  });

  it('sends NO provider key when the tier is unpinned — the pre-existing behaviour', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    resolveDeepResearchTier.mockReturnValue(BASE_TIER);

    await runNewDeepResearch(baseParams('изучи рынок CRM'));

    expect(mockModelCtorArgs.length).toBeGreaterThan(0);
    for (const args of mockModelCtorArgs) {
      expect(args.modelKwargs?.provider).toBeUndefined();
    }
  });

  it('keeps other modelKwargs the endpoint set, rather than replacing them', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    resolveDeepResearchTier.mockReturnValue({ ...BASE_TIER, provider: PIN });
    // An endpoint/spec-level addParams arrives already folded into llmConfig.
    mockInitializeCustom.mockImplementation(async () => ({
      llmConfig: { apiKey: 'k', modelKwargs: { models: ['a/b'] } },
      configOptions: { baseURL: 'http://anonymizer:8000/v1' },
      provider: 'openAI',
    }));

    await runNewDeepResearch(baseParams('изучи рынок CRM'));

    for (const args of mockModelCtorArgs) {
      expect(args.modelKwargs).toEqual({ models: ['a/b'], provider: PIN });
    }
  });
});

/**
 * The run must SAY which models it resolved and where their calls are routed.
 *
 * This line exists because of a live incident: a tier's `leadModel` in librechat.yaml is
 * only the seed — the live value is the admin override in the config collection — and the
 * two diverged silently. A yaml edit that looked deployed (the file was right inside the
 * container) changed nothing, and the only way to discover that was to read billing rows
 * after the fact and notice which model had been charged. Asserting the line exists is not
 * cosmetic: without it the next divergence is invisible again.
 */
describe('runNewDeepResearch — logs the models it actually resolved', () => {
  const { logger } = require('@librechat/data-schemas');
  const { resolveDeepResearchTier } = require('@librechat/api');
  const BASE_TIER = { name: 'balanced', wallClockMinutes: 10 };

  const modelLine = () =>
    logger.info.mock.calls.map((c) => String(c[0])).find((l) => l.includes('] models: lead='));

  /**
   * `jest.clearAllMocks()` in the shared beforeEach clears CALLS, not implementations, so a
   * `mockReturnValue` set here would leak into every later test in this file. Restore the
   * defaults these mocks were declared with.
   */
  afterEach(() => {
    resolveDeepResearchTier.mockReturnValue(BASE_TIER);
    mockLeadModelFor.mockReturnValue('lead-model');
    mockWorkerModelFor.mockReturnValue('worker-model');
  });

  it('names every resolved model, so a stale admin override is visible during the run', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    mockLeadModelFor.mockReturnValue('vendor/lead-x');
    mockWorkerModelFor.mockReturnValue('vendor/worker-y');

    await runNewDeepResearch(baseParams('изучи рынок CRM'));

    const line = modelLine();
    expect(line).toBeDefined();
    expect(line).toContain('lead=vendor/lead-x');
    expect(line).toContain('worker=vendor/worker-y');
  });

  it('reports the provider pin and that it is strict', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    resolveDeepResearchTier.mockReturnValue({
      ...BASE_TIER,
      provider: { order: ['DeepInfra', 'Fireworks'], allow_fallbacks: false },
    });

    await runNewDeepResearch(baseParams('изучи рынок CRM'));

    expect(modelLine()).toContain('providers=DeepInfra>Fireworks (strict)');
  });

  it('says "unpinned" rather than staying silent when no pin is configured', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    resolveDeepResearchTier.mockReturnValue(BASE_TIER);

    await runNewDeepResearch(baseParams('изучи рынок CRM'));

    expect(modelLine()).toContain('providers=unpinned');
  });
});

/**
 * The title call is the tail of every run, and it was reasoning.
 *
 * `1ma` is declared as an OpenRouter endpoint, so `getOpenAILLMConfig` sets
 * `include_reasoning` on every non-Anthropic model. The normal chat path strips it for the
 * title call; DR read `titleModel` and `titlePrompt` from the same config and never this.
 * librechat.yaml records the measurement that made it a requirement: 728 hidden billed
 * tokens, median 8.3 s instead of 0.9 s — on EVERY run.
 */
describe('runNewDeepResearch — the title call must not reason', () => {
  const models = require('~/models');
  const { resolveDeepResearchTier } = require('@librechat/api');
  const TIER = { name: 'balanced', wallClockMinutes: 10 };
  const PIN = { order: ['DeepInfra', 'Fireworks'], allow_fallbacks: false };

  // Set explicitly rather than inherited: a neighbouring describe restores its own tier in
  // afterEach, and depending on that is how the provider-pin gap below went unnoticed.
  beforeEach(() => resolveDeepResearchTier.mockReturnValue(TIER));
  afterEach(() => resolveDeepResearchTier.mockReturnValue(TIER));

  const reasoningEndpoint = () => {
    mockInitializeCustom.mockImplementation(async ({ model_parameters }) => ({
      llmConfig: {
        apiKey: 'sk-client',
        include_reasoning: true,
        model: model_parameters?.model,
      },
      configOptions: { baseURL: 'http://anon.internal:8000/v1' },
      provider: 'openAI',
    }));
  };

  it('disables reasoning on the title model — and on nothing else', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    reasoningEndpoint();
    const params = baseParams('изучи рынок CRM');
    params.req.config.endpoints = { custom: [{ name: '1ma', titleModel: 'title-model' }] };

    await runNewDeepResearch(params);

    const silent = mockModelCtorArgs.filter((a) => a.include_reasoning === false);
    expect(silent).toHaveLength(1);
    expect(silent[0].model).toBe('title-model');
    expect(silent[0].modelKwargs?.reasoning).toEqual({ enabled: false });
    // The graph's own models must keep reasoning: this fix is about the title, and a
    // researcher quietly losing its reasoning would be a far more expensive regression.
    expect(mockModelCtorArgs.filter((a) => a.include_reasoning === true).length).toBeGreaterThan(0);
  });

  it('does not silence a graph model that happens to share the title slug', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    reasoningEndpoint();
    const params = baseParams('изучи рынок CRM');
    // The stand's real configuration: titleModel IS the flash slug the researchers run on.
    params.req.config.endpoints = { custom: [{ name: '1ma', titleModel: 'worker-model' }] };

    await runNewDeepResearch(params);

    const workers = mockModelCtorArgs.filter((a) => a.model === 'worker-model');
    // Two instances of one slug: the researcher's, reasoning; the title's, silent. A cache
    // keyed on the slug alone would have returned one shared model and silenced both.
    expect(workers.filter((a) => a.include_reasoning === true)).toHaveLength(1);
    expect(workers.filter((a) => a.include_reasoning === false)).toHaveLength(1);
  });

  /**
   * The ORDER matters, and only a pinned tier can see it.
   *
   * `disableTitleReasoning` writes `reasoning: { enabled: false }` into `clientOptions
   * .modelKwargs`, and the provider pin is folded into `modelKwargs` a few lines later. Move
   * the call after that fold and the reasoning flag is silently dropped — but ONLY when a pin
   * exists, because without one `modelKwargs` is taken from `clientOptions` by reference.
   * Both live tiers are pinned, so this is the configuration that actually ships.
   */
  it('keeps reasoning disabled AND the provider pin on the title model', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    resolveDeepResearchTier.mockReturnValue({ ...TIER, provider: PIN });
    reasoningEndpoint();
    const params = baseParams('изучи рынок CRM');
    params.req.config.endpoints = { custom: [{ name: '1ma', titleModel: 'title-model' }] };

    await runNewDeepResearch(params);

    const silent = mockModelCtorArgs.filter((a) => a.include_reasoning === false);
    expect(silent).toHaveLength(1);
    expect(silent[0].modelKwargs).toEqual({ provider: PIN, reasoning: { enabled: false } });
  });

  it('honours titleConvo: false — no model call is spent naming the chat', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    reasoningEndpoint();
    const params = baseParams('изучи рынок CRM');
    params.req.config.endpoints = { custom: [{ name: '1ma', titleConvo: false }] };

    await runNewDeepResearch(params);

    expect(mockModelCtorArgs.filter((a) => a.include_reasoning === false)).toHaveLength(0);
    // The chat is still named, deterministically — a DR run never degrades to "New Chat".
    const saved = models.saveConvo.mock.calls[0][1].title;
    expect(saved).toBeTruthy();
    expect(saved).not.toBe('Сравнение CRM-систем');
  });
});

/**
 * A run that is not admitted must leave no trace that it was.
 *
 * The admission stamp used to be written and saved BEFORE the concurrency caps were checked,
 * so a refused start still marked the user's message drKind='start'. The plan card lost its
 * action buttons, and the retry the refusal message asks for was then classified as a
 * duplicate START and answered "already running, wait for the report" — for a run that had
 * been refused and never existed.
 */
describe('runNewDeepResearch — a refused run leaves no admission stamp', () => {
  const api = require('@librechat/api');
  const planStart = () => {
    const params = baseParams('▶ Начать исследование');
    params.turn = { kind: 'plan-start', dialogue: 'изучи рынок CRM', duplicateStart: false };
    return params;
  };

  it('does not stamp the user message when the per-user cap refuses the run', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    api.GenerationJobManager.getActiveJobIdsForUser.mockResolvedValueOnce(['a', 'b', 'c']);

    await runNewDeepResearch(planStart());

    const userMsg = mockSavedMessages.find((m) => m.messageId === 'um1');
    // The message IS still persisted — the finalize tail saves it for every outcome. What a
    // refused run must not leave behind is the 'start' PROVENANCE, which is what makes the
    // retry look like a duplicate. Without this line the assertion below would also pass if
    // the message stopped being saved at all.
    expect(userMsg).toBeDefined();
    expect(userMsg.drKind).toBeUndefined();
  });

  it('still stamps a start that IS admitted (the control)', async () => {
    mockStartSovereignSession.mockResolvedValue(null);

    await runNewDeepResearch(planStart());

    const userMsg = mockSavedMessages.find((m) => m.messageId === 'um1');
    expect(userMsg?.drKind).toBe('start');
  });
});

/**
 * Each node must be built from the slug ITS resolver returned. `reportModelFor` was a live
 * function returning a dead value for years — nothing downstream had to use it — so the
 * resolver having a test is not the same as the runner asking it.
 */
describe('runNewDeepResearch — every node is built from its own resolver', () => {
  it('builds lead, worker, compress and report from their resolved slugs', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    mockInitializeCustom.mockImplementation(async ({ model_parameters }) => ({
      llmConfig: { apiKey: 'sk-client', model: model_parameters?.model },
      configOptions: { baseURL: 'http://anon.internal:8000/v1' },
      provider: 'openAI',
    }));

    await runNewDeepResearch(baseParams('изучи рынок CRM'));

    const built = mockModelCtorArgs.map((a) => a.model);
    for (const slug of ['lead-model', 'worker-model', 'compress-model', 'report-model']) {
      expect(built).toContain(slug);
    }
  });
});

describe('runNewDeepResearch — a conversation the run creates keeps its model card', () => {
  const models = require('~/models');

  it('persists spec, so continuing the chat normally keeps the card routing', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    const params = baseParams('изучи рынок CRM');
    params.req.body.spec = 'auto';

    await runNewDeepResearch(params);

    expect(models.saveConvo.mock.calls[0][1].spec).toBe('auto');
  });

  it('writes no spec key when the chat has no card', async () => {
    mockStartSovereignSession.mockResolvedValue(null);

    await runNewDeepResearch(baseParams('изучи рынок CRM'));

    expect(models.saveConvo.mock.calls[0][1]).not.toHaveProperty('spec');
  });
});

describe('buildDeepResearchCollectedUsage — a run is billed per ANSWERING model', () => {
  /**
   * The balanced tier runs the lead at 1.32/3.96 and the worker at a fraction of that, and
   * the worker does most of the talking. Billing the aggregate under the lead's slug is what
   * made the journal's DR figure wrong by multiples.
   */
  it('splits the run into one entry per model instead of one entry at the lead rate', () => {
    const { entries } = buildDeepResearchCollectedUsage({
      model: 'deepseek/deepseek-v4-pro-0813',
      usage: { input: 110_000, output: 12_000, total: 122_000 },
      usageByModel: {
        'deepseek/deepseek-v4-pro-0813': {
          input: 10_000,
          output: 2_000,
          total: 12_000,
          estimated: 0,
        },
        'deepseek/deepseek-v4-flash-0731': {
          input: 100_000,
          output: 10_000,
          total: 110_000,
          estimated: 0,
        },
      },
    });

    expect(entries).toEqual([
      { model: 'deepseek/deepseek-v4-pro-0813', input_tokens: 10_000, output_tokens: 2_000 },
      { model: 'deepseek/deepseek-v4-flash-0731', input_tokens: 100_000, output_tokens: 10_000 },
    ]);
    // The lead must NOT carry the worker's tokens — that is the whole defect.
    const lead = entries.find((e) => e.model === 'deepseek/deepseek-v4-pro-0813');
    expect(lead.input_tokens).toBe(10_000);
  });

  it('bills the same total the run measured, never more', () => {
    const usage = { input: 110_000, output: 12_000, total: 122_000 };
    const { entries } = buildDeepResearchCollectedUsage({
      model: 'lead',
      usage,
      usageByModel: {
        lead: { input: 10_000, output: 2_000, total: 12_000, estimated: 0 },
        worker: { input: 100_000, output: 10_000, total: 110_000, estimated: 0 },
      },
    });

    expect(entries.reduce((n, e) => n + e.input_tokens, 0)).toBe(usage.input);
    expect(entries.reduce((n, e) => n + e.output_tokens, 0)).toBe(usage.output);
  });

  /**
   * A node that forgets to report its model would silently bill LESS than the run spent.
   * The aggregate is the authority: on disagreement the split is discarded, loudly.
   */
  it('falls back to the aggregate — and says so — when the split does not add up', () => {
    const { entries, note } = buildDeepResearchCollectedUsage({
      model: 'lead',
      usage: { input: 110_000, output: 12_000, total: 122_000 },
      usageByModel: { worker: { input: 100_000, output: 10_000, total: 110_000, estimated: 0 } },
    });

    expect(entries).toEqual([{ model: 'lead', input_tokens: 110_000, output_tokens: 12_000 }]);
    expect(note).toMatch(/does not add up/);
  });

  it('keeps the old single-entry behaviour when no per-model usage was reported', () => {
    const { entries, note } = buildDeepResearchCollectedUsage({
      model: 'lead',
      usage: { input: 5, output: 6, total: 11 },
      usageByModel: {},
    });

    expect(entries).toEqual([{ model: 'lead', input_tokens: 5, output_tokens: 6 }]);
    expect(note).toMatch(/no per-model usage/);
  });

  /**
   * Estimated tokens are billed like reported ones, but a reconciliation against the
   * OpenRouter invoice has to be able to tell which figure it is arguing with.
   */
  it('names estimated tokens so a later reconciliation is not chasing arithmetic', () => {
    const { note } = buildDeepResearchCollectedUsage({
      model: 'lead',
      usage: { input: 100, output: 20, total: 120 },
      usageByModel: { lead: { input: 100, output: 20, total: 120, estimated: 120 } },
    });

    expect(note).toMatch(/120 of those tokens are a LENGTH ESTIMATE/);
  });

  it('says nothing about estimates when every token was reported by the provider', () => {
    const { note } = buildDeepResearchCollectedUsage({
      model: 'lead',
      usage: { input: 100, output: 20, total: 120 },
      usageByModel: { lead: { input: 100, output: 20, total: 120, estimated: 0 } },
    });

    expect(note).not.toMatch(/ESTIMATE/);
  });
});

/**
 * `file_search` reports its failures by RETURNING a sentence, not by throwing — and the
 * research loop decides "this produced nothing" from a throw. So a dead RAG service used to
 * flow into the gathered material, get compressed into a digest, pass `hasResearchMaterial`
 * and come back as a confident report with a PDF built out of "The document search service is
 * temporarily unavailable." #411 closed exactly this hole for `web_search`, which throws.
 */
describe('failOnToolReportedError — a tool that REPORTS failure now fails', () => {
  const { failOnToolReportedError, FILE_SEARCH_FAILURE_MARKERS } = require('./deepResearchRun');

  const toolReturning = (value) => ({ name: 'file_search', invoke: async () => value });

  it('throws on every failure sentence file_search can return', async () => {
    expect(FILE_SEARCH_FAILURE_MARKERS.length).toBeGreaterThan(0);
    for (const marker of FILE_SEARCH_FAILURE_MARKERS) {
      const tool = failOnToolReportedError(toolReturning(marker), FILE_SEARCH_FAILURE_MARKERS);
      await expect(tool.invoke({}, {})).rejects.toThrow(marker.slice(0, 24));
    }
  });

  it('also sees the sentence inside a ToolMessage-shaped result', async () => {
    const marker = FILE_SEARCH_FAILURE_MARKERS[0];
    const tool = failOnToolReportedError(
      toolReturning({ content: marker }),
      FILE_SEARCH_FAILURE_MARKERS,
    );
    await expect(tool.invoke({}, {})).rejects.toThrow();
  });

  it('passes real search results through untouched', async () => {
    const hit = 'File: Договор.pdf\nСтороны договорились…';
    const tool = failOnToolReportedError(toolReturning(hit), FILE_SEARCH_FAILURE_MARKERS);
    await expect(tool.invoke({}, {})).resolves.toBe(hit);
  });

  it('leaves a tool without invoke alone rather than throwing', () => {
    expect(failOnToolReportedError(null, FILE_SEARCH_FAILURE_MARKERS)).toBeNull();
  });

  /**
   * The sentences live in another file. If someone rewords them there, this wrapper silently
   * stops matching and the hole reopens with every test still green — so the drift is asserted
   * rather than hoped for.
   */
  it('the sentences it matches still exist in fileSearch.js', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '../../../../app/clients/tools/util/fileSearch.js'),
      'utf8',
    );
    for (const marker of FILE_SEARCH_FAILURE_MARKERS) {
      expect(source).toContain(marker);
    }
  });
});

describe('the live card does not promise rounds the budget will not buy', () => {
  const { drProgressFraction } = require('./deepResearchRun');

  /**
   * `maxRounds` is the CONFIGURED cap and a run almost never reaches it — the budget gate
   * stops first. Dividing by it made the bar crawl to 0.35 on a run that afforded two of six
   * rounds and then jump to the 0.92 the report step claims, skipping two checklist steps.
   */
  it('advances on every round without racing the configured cap', () => {
    const at = (round) => drProgressFraction({ type: 'research', round }, 6, 0);

    expect(at(1)).toBeGreaterThan(0.35);
    expect(at(2)).toBeGreaterThan(at(1));
    expect(at(3)).toBeGreaterThan(at(2));
  });

  it('FAILS ON PRE-FIX CODE: two rounds of six no longer leave the bar at a third', () => {
    expect(drProgressFraction({ type: 'research', round: 2 }, 6, 0)).toBeGreaterThan(
      0.1 + 0.75 * (2 / 6),
    );
  });

  it('never reaches the fraction the report step claims', () => {
    for (const round of [1, 2, 4, 8, 16, 64]) {
      expect(drProgressFraction({ type: 'research', round }, 6, 0)).toBeLessThan(0.92);
    }
  });

  it('keeps the scope and report anchors', () => {
    expect(drProgressFraction({ type: 'scope' }, 6, 0)).toBe(0.08);
    expect(drProgressFraction({ type: 'report' }, 6, 0)).toBe(0.92);
  });
});

describe('the report phase has a curve of its own (the last minutes stop reading as hung)', () => {
  const { drReportFraction, drReportAction } = require('./deepResearchRun');
  const MIN = 60_000;

  it('starts exactly where the report step stood and only ever rises', () => {
    expect(drReportFraction(0)).toBe(0.92);
    for (const ms of [10_000, MIN, 3 * MIN, 10 * MIN, 30 * MIN]) {
      expect(drReportFraction(ms)).toBeGreaterThan(drReportFraction(ms / 2));
    }
  });

  it('never arrives — only the end of the run fills the bar', () => {
    // A curve that could reach its ceiling on its own would freeze again, one number
    // higher, on exactly the long reports this was written for.
    expect(drReportFraction(60 * MIN)).toBeLessThan(0.99);
    expect(drReportFraction(5 * MIN)).toBeLessThan(0.99);
  });

  it('names the elapsed time only once the phase has actually been running', () => {
    expect(drReportAction(0)).toBe('Формирует отчёт');
    expect(drReportAction(29_000)).toBe('Формирует отчёт');
    expect(drReportAction(45_000)).toBe('Формирует отчёт — 45 с');
    expect(drReportAction(130_000)).toBe('Формирует отчёт — 2 мин 10 с');
  });
});

describe('a truncated run is recorded, not announced (owner decision 27.08.2026)', () => {
  /**
   * A report written from less material is still a real synthesis. A line under it saying
   * so reads to a client as "this platform is unreliable" far more loudly than it reads as
   * candour, so no surface shows one any more: not the chat, not the reader, not the share
   * page, and not the PDF.
   *
   * What must NOT go with it is the record. `unfinished` is still stamped on the message —
   * `tools/dr_run_metrics/snapshot.py` counts truncated runs straight off `db.messages`,
   * and that count is how the budget work was proved (4 of 9 before, 0 of 5 after). Drop
   * the flag to "clean up" and the measurement silently reports zero forever.
   */
  it('stamps the flag on a run whose gathering hit the budget gate', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    mockRunDeepResearch.mockImplementationOnce(async () => ({
      finalReport: '# Отчёт\n\nВывод.',
      finalizeReason: 'budget',
      usage: { input: 1, output: 1, total: 2 },
      findings: [],
    }));

    await runNewDeepResearch(baseParams('изучи рынок CRM'));

    expect(mockSavedMessages.find((m) => m.messageId === 'r1').unfinished).toBe(true);
  });

  it('leaves a complete run unflagged (the control)', async () => {
    mockStartSovereignSession.mockResolvedValue(null);

    await runNewDeepResearch(baseParams('изучи рынок CRM'));

    expect(mockSavedMessages.find((m) => m.messageId === 'r1').unfinished).toBe(false);
  });

  /**
   * FAILS ON PRE-CHANGE CODE: the PDF used to open with «Сбор материала остановился
   * раньше…». The PDF is the copy that leaves the chat — forwarded, printed, mailed on —
   * so a caveat left there is the one that travels furthest.
   */
  it('hands the PDF the report itself, with nothing prepended to it', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    const report = '# Отчёт\n\nВывод.';
    mockRunDeepResearch.mockImplementationOnce(async () => ({
      finalReport: report,
      finalizeReason: 'budget',
      usage: { input: 1, output: 1, total: 2 },
      findings: [],
    }));

    await runNewDeepResearch(baseParams('изучи рынок CRM'));

    expect(mockReportToPdfBuffer).toHaveBeenCalledTimes(1);
    expect(mockReportToPdfBuffer.mock.calls[0][0]).toBe(report);
  });
});
