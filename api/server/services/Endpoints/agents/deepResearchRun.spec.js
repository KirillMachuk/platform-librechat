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
let mockTitleContent = 'Сравнение CRM-систем';
let mockTitleThrows = false;
let mockClarifyContent = '{"action":"PROCEED","questions":[]}';
class mockFakeModel {
  constructor(opts) {
    mockModelCtorArgs.push(opts);
  }
  async invoke(messages) {
    mockInvokeArgs.push(messages);
    if (mockTitleThrows) {
      throw new Error('title model unavailable');
    }
    const system = messages?.[0]?.content;
    if (typeof system === 'string' && system.includes('модуль УТОЧНЕНИЯ')) {
      return { content: mockClarifyContent };
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
  leadModelFor: jest.fn(() => 'lead-model'),
  workerModelFor: jest.fn(() => 'worker-model'),
  reportModelFor: jest.fn(() => 'report-model'),
  compressModelFor: jest.fn(() => 'compress-model'),
  reportToPdfBuffer: (...a) => mockReportToPdfBuffer(...a),
  getStorageMetadata: jest.fn(() => ({})),
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

const {
  runNewDeepResearch,
  buildDeepResearchTitle,
  isClarifyFollowUp,
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
    userMessage: { messageId: 'um1' },
    text,
  };
}

const REPORT = 'Отчёт про [PERSON_1] и публичную компанию Apple';

beforeEach(() => {
  jest.clearAllMocks();
  mockSavedMessages.length = 0;
  mockModelCtorArgs.length = 0;
  mockInvokeArgs.length = 0;
  mockTitleContent = 'Сравнение CRM-систем';
  mockTitleThrows = false;
  mockClarifyContent = '{"action":"PROCEED","questions":[]}';
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

describe('isClarifyFollowUp (badge-independent DR routing for clarify replies)', () => {
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
      isClarifyFollowUp({ userId: 'u1', conversationId: 'c1', parentMessageId: 'p1' }),
    ).resolves.toBe(true);
    expect(models.getMessages).toHaveBeenCalledWith(
      { conversationId: 'c1', user: 'u1', messageId: 'p1' },
      'messageId text isCreatedByUser',
    );
  });

  it('is FALSE for a normal parent, a user-authored parent, and a missing parent', async () => {
    models.getMessages.mockResolvedValueOnce([
      { messageId: 'p1', isCreatedByUser: false, text: '## Отчёт по CRM' },
    ]);
    await expect(
      isClarifyFollowUp({ userId: 'u1', conversationId: 'c1', parentMessageId: 'p1' }),
    ).resolves.toBe(false);

    models.getMessages.mockResolvedValueOnce([
      {
        messageId: 'p1',
        isCreatedByUser: true,
        text: '**Уточните, пожалуйста, детали исследования:** копия',
      },
    ]);
    await expect(
      isClarifyFollowUp({ userId: 'u1', conversationId: 'c1', parentMessageId: 'p1' }),
    ).resolves.toBe(false);

    models.getMessages.mockResolvedValueOnce([]);
    await expect(
      isClarifyFollowUp({ userId: 'u1', conversationId: 'c1', parentMessageId: 'p1' }),
    ).resolves.toBe(false);
  });

  it('is FALSE without a real parent (first message) and never queries', async () => {
    await expect(
      isClarifyFollowUp({ userId: 'u1', conversationId: 'c1', parentMessageId: NO_PARENT }),
    ).resolves.toBe(false);
    await expect(
      isClarifyFollowUp({ userId: 'u1', conversationId: 'c1', parentMessageId: null }),
    ).resolves.toBe(false);
    expect(models.getMessages).not.toHaveBeenCalled();
  });

  it('fails CLOSED (false) on a lookup error', async () => {
    models.getMessages.mockRejectedValueOnce(new Error('mongo down'));
    await expect(
      isClarifyFollowUp({ userId: 'u1', conversationId: 'c1', parentMessageId: 'p1' }),
    ).resolves.toBe(false);
  });
});
