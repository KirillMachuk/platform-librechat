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
class mockFakeModel {
  constructor(opts) {
    mockModelCtorArgs.push(opts);
  }
}

const mockRunDeepResearch = jest.fn();
const mockStartSovereignSession = jest.fn();
const mockInitializeCustom = jest.fn();
const mockCreateDeepResearchGraph = jest.fn(() => ({}));
const mockEmitDone = jest.fn();
const mockCompleteJob = jest.fn();
const mockSavedMessages = [];

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
}));

jest.mock('@librechat/data-schemas', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('~/app/clients/tools/util/fileSearch', () => ({ createFileSearchTool: jest.fn() }));
jest.mock('~/server/services/Files/permissions', () => ({
  filterRequestFilesByAccess: jest.fn(async () => []),
}));
jest.mock('~/server/services/Tools/credentials', () => ({ loadAuthValues: jest.fn() }));

jest.mock('~/models', () => ({
  getFiles: jest.fn(async () => []),
  getConvo: jest.fn(async () => ({ conversationId: 'c1', title: 't' })),
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

const { runNewDeepResearch, buildDeepResearchTitle } = require('./deepResearchRun');

function baseParams(text) {
  return {
    req: { config: {}, user: { role: 'user' }, body: {} },
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
