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
const mockEmitDone = jest.fn();
const mockCompleteJob = jest.fn();
const mockSavedMessages = [];
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

jest.mock('@librechat/agents', () => ({
  Providers: { OPENAI: 'openAI' },
  getChatModelClass: jest.fn(() => mockFakeModel),
  createSearchTool: jest.fn(() => ({ name: 'web_search' })),
}));

jest.mock('@librechat/api', () => ({
  sendEvent: jest.fn(),
  initializeCustom: (...a) => mockInitializeCustom(...a),
  runDeepResearch: (...a) => mockRunDeepResearch(...a),
  startSovereignSession: (...a) => mockStartSovereignSession(...a),
  createDeepResearchGraph: (...a) => mockCreateDeepResearchGraph(...a),
  loadWebSearchAuth: jest.fn(async () => ({ authenticated: false })),
  tierToRunBudget: jest.fn(() => ({})),
  GenerationJobManager: {
    emitChunk: jest.fn(),
    emitDone: (...a) => mockEmitDone(...a),
    completeJob: (...a) => mockCompleteJob(...a),
    getActiveJobIdsForUser: jest.fn(async () => []),
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
  // Faithful mirror of the real length-estimate fallback (no usage_metadata on fakes).
  usageFromExchange: (prompt, response) => {
    const promptText = prompt.map((m) => String(m.content ?? '')).join(' ');
    const responseText = typeof response?.content === 'string' ? response.content : '';
    const input = Math.ceil(promptText.length / 4);
    const output = Math.ceil(responseText.length / 4);
    return { input, output, total: input + output };
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
  buildPlanPrompt: ({ now, allowClarify = true }) =>
    `Ты — модуль ПЛАНИРОВАНИЯ. ${now}${allowClarify ? '' : ' CLARIFY запрещено'}`,
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
    if (action === 'PLAN' && steps.length) {
      return { action: 'PLAN', questions: [], title, steps };
    }
    return { action: 'PROCEED', questions: [], title: '', steps: [] };
  },
  formatPlanMessage: ({ title, steps }) =>
    `${`**План исследования:** ${title}`.trimEnd()}\n\n${steps
      .map((s, i) => `${i + 1}. ${s}`)
      .join('\n')}`,
  isPlanMessage: (text) =>
    typeof text === 'string' && text.trimStart().startsWith('**План исследования:**'),
  isStartCommand: (text) => typeof text === 'string' && text.trim() === '▶ Начать исследование',
  isCancelCommand: (text) => typeof text === 'string' && text.trim() === '✕ Отменить исследование',
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
  getConvo: jest.fn(async () => ({ conversationId: 'c1', title: 't' })),
  getMessages: jest.fn(async () => []),
  saveConvo: jest.fn(async () => ({ conversationId: 'c1' })),
  saveMessage: jest.fn(async (ctx, msg) => {
    mockSavedMessages.push(msg);
    return msg;
  }),
  spendTokens: jest.fn(),
  getMultiplier: jest.fn(),
  getConvoFiles: jest.fn(async () => []),
  updateBalance: jest.fn(),
  getCacheMultiplier: jest.fn(),
  spendStructuredTokens: jest.fn(),
  bulkInsertTransactions: jest.fn(),
}));

const { runNewDeepResearch, buildDeepResearchTitle, isDrFollowUp } = require('./deepResearchRun');

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
      { messageId: 'q0', parentMessageId: null, text: 'посоветуй CRM' },
      {
        messageId: 'p1',
        parentMessageId: 'q0',
        text: '**Уточните, пожалуйста, детали исследования:**\n1. Масштаб?',
      },
    ]);
    mockClarifyContent = '{"action":"CLARIFY","questions":["не должно быть использовано"]}';

    await runNewDeepResearch(clarifyParams('малый бизнес, до 10 человек'));

    expect(mockRunDeepResearch).toHaveBeenCalledTimes(1);
    const input = mockRunDeepResearch.mock.calls[0][0].input.messages[0].content;
    expect(input).toContain('Диалог уточнения');
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
  it('a nodata run gets NO PDF and keeps the unfinished flag', async () => {
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
    expect(msg.unfinished).toBe(true);
    expect(msg.text).toContain('Не удалось собрать материал');
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

describe('isDrFollowUp (badge-independent DR routing for clarify + plan replies)', () => {
  const models = require('~/models');
  const NO_PARENT = '00000000-0000-0000-0000-000000000000';

  it('is TRUE when the parent is the assistant clarify message', async () => {
    models.getMessages.mockResolvedValueOnce([
      {
        messageId: 'p1',
        isCreatedByUser: false,
        text: '**Уточните, пожалуйста, детали исследования:**\n1. Масштаб?',
      },
    ]);
    await expect(
      isDrFollowUp({ userId: 'u1', conversationId: 'c1', parentMessageId: 'p1' }),
    ).resolves.toBe(true);
    expect(models.getMessages).toHaveBeenCalledWith(
      { conversationId: 'c1', user: 'u1', messageId: 'p1' },
      'messageId text isCreatedByUser',
    );
  });

  it('is TRUE when the parent is a plan card (task #21)', async () => {
    models.getMessages.mockResolvedValueOnce([
      {
        messageId: 'p1',
        isCreatedByUser: false,
        text: '**План исследования:** Рынок CRM\n\n1. Собрать\n2. Сравнить',
      },
    ]);
    await expect(
      isDrFollowUp({ userId: 'u1', conversationId: 'c1', parentMessageId: 'p1' }),
    ).resolves.toBe(true);
  });

  it('is FALSE for a normal parent, a user-authored parent, and a missing parent', async () => {
    models.getMessages.mockResolvedValueOnce([
      { messageId: 'p1', isCreatedByUser: false, text: '## Отчёт по CRM' },
    ]);
    await expect(
      isDrFollowUp({ userId: 'u1', conversationId: 'c1', parentMessageId: 'p1' }),
    ).resolves.toBe(false);

    models.getMessages.mockResolvedValueOnce([
      {
        messageId: 'p1',
        isCreatedByUser: true,
        text: '**Уточните, пожалуйста, детали исследования:** копия',
      },
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
        text: '**План исследования:** Рынок CRM\n\n1. Собрать\n2. Сравнить',
      },
    ]);

    await runNewDeepResearch(planParams('▶ Начать исследование'));

    expect(mockRunDeepResearch).toHaveBeenCalledTimes(1);
    // The graph researches the approved dialogue (original request survives), not the marker.
    const graphInput = mockRunDeepResearch.mock.calls[0][0].input.messages[0].content;
    expect(graphInput).toContain('изучи CRM рынок');
    expect(graphInput).not.toContain('▶ Начать исследование');
  });

  it('CANCEL on a plan parent: terminal cancelled message, no graph, no model calls', async () => {
    mockStartSovereignSession.mockResolvedValue(null);
    models.getMessages.mockResolvedValueOnce([
      { messageId: 'orig', isCreatedByUser: true, parentMessageId: null, text: 'изучи CRM' },
      {
        messageId: 'p1',
        isCreatedByUser: false,
        parentMessageId: 'orig',
        text: '**План исследования:** Рынок CRM\n\n1. Собрать',
      },
    ]);

    const result = await runNewDeepResearch(planParams('✕ Отменить исследование'));

    expect(result.finalizeReason).toBe('cancelled');
    expect(mockRunDeepResearch).not.toHaveBeenCalled();
    expect(mockInvokeArgs).toHaveLength(0); // no decision + no title model call
    const msg = mockSavedMessages.find((m) => m.messageId === 'r1');
    expect(msg.text).toBe('Исследование отменено.');
    expect(msg.unfinished).toBe(false);
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
        text: '**Уточните, пожалуйста, детали исследования:**\n1. Масштаб?',
      },
    ]);

    const result = await runNewDeepResearch(
      planParams('малый бизнес, 20 человек', { clarify: true }),
    );

    expect(result.finalizeReason).toBe('plan');
    expect(mockRunDeepResearch).not.toHaveBeenCalled();
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
});
