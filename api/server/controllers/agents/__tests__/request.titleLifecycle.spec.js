/**
 * The title lifecycle, driven through the REAL resumable controller.
 *
 * Three earlier fixes to titles shipped with green suites that pinned helpers or the
 * shape of the code while the defect lived in how the controller wired them. This suite
 * runs `ResumableAgentController` end to end with a scripted agent client, so it fails
 * on what a user sees: when a title reaches the database, which text it names, whether
 * a Stop kills it, and how long a later turn waits for it.
 */
const { EventEmitter } = require('events');

const mockLogger = { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() };

const mockGenerationJobManager = {
  createJob: jest.fn(),
  getJob: jest.fn(),
  emitChunk: jest.fn(),
  emitDone: jest.fn(),
  emitError: jest.fn(),
  completeJob: jest.fn(),
  updateMetadata: jest.fn(),
  setContentParts: jest.fn(),
  getResumeState: jest.fn(),
  recordHeartbeat: jest.fn(),
};

const mockGetConvo = jest.fn();
const mockGetMessages = jest.fn();
const mockSaveMessage = jest.fn();
const mockDisposeClient = jest.fn();

jest.mock('@librechat/data-schemas', () => ({ logger: mockLogger }));

jest.mock('@librechat/api', () => ({
  ...jest.requireActual('@librechat/api'),
  sendEvent: jest.fn(),
  getViolationInfo: jest.fn(),
  buildMessageFiles: jest.fn(() => []),
  resolveTitleTiming: jest.fn(() => 'immediate'),
  GenerationJobManager: mockGenerationJobManager,
  filterPersistableAbortContent: jest.fn((content) => content),
  decrementPendingRequest: jest.fn(async () => undefined),
  sanitizeMessageForTransmit: jest.fn((message) => message),
  checkAndIncrementPendingRequest: jest.fn(async () => ({ allowed: true })),
  isUnpersistedPreliminaryParent: jest.fn(async () => false),
}));

jest.mock('~/server/cleanup', () => ({
  disposeClient: (...args) => mockDisposeClient(...args),
  clientRegistry: null,
  requestDataMap: { set: jest.fn() },
}));

jest.mock('~/server/services/MCPRequestContext', () => ({
  getMCPRequestContext: jest.fn(),
  cleanupMCPRequestContextForReq: jest.fn(async () => undefined),
}));

jest.mock('~/server/middleware', () => ({ handleAbortError: jest.fn(() => Promise.resolve()) }));
jest.mock('~/cache', () => ({ logViolation: jest.fn() }));

jest.mock('~/models', () => ({
  saveMessage: (...args) => mockSaveMessage(...args),
  getMessages: (...args) => mockGetMessages(...args),
  getConvo: (...args) => mockGetConvo(...args),
  getRoleByName: jest.fn(),
}));

jest.mock('~/server/services/Endpoints/agents/deepResearchRun', () => ({
  runNewDeepResearch: jest.fn(),
  isDrFollowUp: jest.fn(async () => false),
  buildDrTurnContext: jest.fn(),
}));

const AgentController = require('../request');

const NO_PARENT = '00000000-0000-0000-0000-000000000000';
const JOB_CREATED_AT = 1000;

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function makeRes() {
  const res = new EventEmitter();
  res.headersSent = false;
  res.json = jest.fn(() => {
    res.headersSent = true;
  });
  res.status = jest.fn(() => res);
  return res;
}

/**
 * An agent client whose turn is a script: `turn(client, options)` plays the part of
 * `sendMessage` — it may report the user-message save, start the run, press Stop — and
 * returns the response.
 */
function makeClient(turn) {
  const client = {
    run: null,
    sender: 'AI',
    contentParts: [],
    savedMessageIds: new Set(),
    skipSaveUserMessage: true,
    options: { agent: { endpoint: 'agents' } },
  };
  client.sendMessage = jest.fn((text, options) => turn(client, options));
  return client;
}

function response(conversationId, title = 'New Chat') {
  return {
    messageId: 'response-1',
    conversationId,
    text: 'ответ',
    databasePromise: Promise.resolve({ conversation: { conversationId, title } }),
  };
}

async function runTurn({ body, client, addTitle }) {
  const job = {
    createdAt: JOB_CREATED_AT,
    readyPromise: Promise.resolve(),
    abortController: new AbortController(),
    emitter: { on: jest.fn() },
  };
  mockGenerationJobManager.createJob.mockResolvedValue(job);
  const turnEnded = deferred();
  mockDisposeClient.mockImplementation(() => turnEnded.resolve('disposed'));

  const req = {
    user: { id: 'user-1' },
    body: {
      text: body.text,
      messageId: 'user-msg-1',
      parentMessageId: body.parentMessageId ?? NO_PARENT,
      conversationId: body.conversationId,
      endpointOption: { endpoint: 'agents', model_parameters: { model: 'm' } },
    },
    config: {},
  };
  const initializeClient = jest.fn(async () => ({ client }));
  await AgentController(req, makeRes(), jest.fn(), initializeClient, addTitle);
  return { job, turnEnded: turnEnded.promise };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGenerationJobManager.getJob.mockResolvedValue({ createdAt: JOB_CREATED_AT });
  mockGenerationJobManager.emitChunk.mockResolvedValue(undefined);
  mockGenerationJobManager.emitDone.mockResolvedValue(undefined);
  mockGenerationJobManager.updateMetadata.mockResolvedValue(undefined);
  mockGenerationJobManager.getResumeState.mockResolvedValue(null);
  mockSaveMessage.mockResolvedValue({});
  mockGetMessages.mockResolvedValue([]);
  mockGetConvo.mockResolvedValue(null);
});

describe('a new chat: the title reaches the database with the user message, not the answer', () => {
  it('persistence is unblocked while the answer is still being written', async () => {
    const events = [];
    const answerMayFinish = deferred();
    const addTitle = jest.fn(async (_req, { convoReady }) => {
      await convoReady;
      events.push('title saved');
      return 'Погода в Минске';
    });
    const client = makeClient(async (self, options) => {
      /* `BaseClient.sendMessage` reports twice: the ids first, before anything is saved,
       * and the save promise later. Only the second may unblock persistence. */
      options.getReqData({
        userMessage: { messageId: 'user-msg-1' },
        conversationId: options.conversationId,
        responseMessageId: 'response-1',
        sender: 'AI',
      });
      await flush();
      events.push('ids reported');
      const userSaved = deferred();
      options.getReqData({ userMessagePromise: userSaved.promise });
      self.run = {};
      await flush();
      events.push('user message saved');
      userSaved.resolve({});
      await answerMayFinish.promise;
      events.push('answer saved');
      return response(options.conversationId);
    });

    const { turnEnded } = await runTurn({
      body: { text: 'какая погода в минске', conversationId: 'new' },
      client,
      addTitle,
    });
    for (let i = 0; i < 10 && !events.includes('title saved'); i++) {
      await flush();
    }
    answerMayFinish.resolve();
    await turnEnded;

    expect(events).toEqual(['ids reported', 'user message saved', 'title saved', 'answer saved']);
  });
});

describe('an existing chat still called «New Chat» is titled on its next turn', () => {
  it('a follow-up titles the chat from its opening question', async () => {
    mockGetConvo.mockResolvedValue({ title: 'New Chat', createdAt: '2026-09-14T10:24:46.959Z' });
    mockGetMessages.mockResolvedValue([{ text: 'какая погода в минске' }]);
    const addTitle = jest.fn(async () => 'Погода в Минске');
    const client = makeClient(async (self, options) => {
      self.run = {};
      return response(options.conversationId);
    });

    const { turnEnded } = await runTurn({
      body: { text: 'продолжи', conversationId: 'c-1', parentMessageId: 'answer-0' },
      client,
      addTitle,
    });
    await turnEnded;

    expect(addTitle).toHaveBeenCalledTimes(1);
    expect(addTitle.mock.calls[0][1]).toEqual(
      expect.objectContaining({ text: 'какая погода в минске', conversationId: 'c-1' }),
    );
  });

  it('an edit of the first message titles from the edited text', async () => {
    mockGetConvo.mockResolvedValue({ title: 'New Chat', createdAt: '2026-09-14T10:24:46.959Z' });
    const addTitle = jest.fn(async () => 'Погода в Минске');
    const client = makeClient(async (self, options) => {
      self.run = {};
      return response(options.conversationId);
    });

    const { turnEnded } = await runTurn({
      body: { text: 'какая погода в минске', conversationId: 'c-1' },
      client,
      addTitle,
    });
    await turnEnded;

    expect(addTitle.mock.calls[0][1].text).toBe('какая погода в минске');
    expect(mockGetMessages).not.toHaveBeenCalledWith(
      expect.objectContaining({ isCreatedByUser: true }),
      'text',
    );
  });

  it('a chat that already has a real title is left alone', async () => {
    mockGetConvo.mockResolvedValue({ title: 'Мой отчёт', createdAt: '2026-09-14T10:24:46.959Z' });
    const addTitle = jest.fn(async () => 'Другое');
    const client = makeClient(async (self, options) => {
      self.run = {};
      return response(options.conversationId, 'Мой отчёт');
    });

    const { turnEnded } = await runTurn({
      body: { text: 'продолжи', conversationId: 'c-1', parentMessageId: 'answer-0' },
      client,
      addTitle,
    });
    await turnEnded;

    expect(addTitle).not.toHaveBeenCalled();
  });

  it('a later turn does not hold its final event for a title model that hangs', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    try {
      mockGetConvo.mockResolvedValue({ title: 'New Chat', createdAt: '2026-09-14T10:24:46.959Z' });
      mockGetMessages.mockResolvedValue([{ text: 'какая погода в минске' }]);
      const addTitle = jest.fn(() => new Promise(() => {}));
      const client = makeClient(async (self, options) => {
        self.run = {};
        return response(options.conversationId);
      });

      await runTurn({
        body: { text: 'продолжи', conversationId: 'c-1', parentMessageId: 'answer-0' },
        client,
        addTitle,
      });
      await jest.advanceTimersByTimeAsync(200);
      expect(mockGenerationJobManager.emitDone).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(5000);
      for (let i = 0; i < 10 && !mockGenerationJobManager.emitDone.mock.calls.length; i++) {
        await flush();
      }
      expect(mockGenerationJobManager.emitDone).toHaveBeenCalledTimes(1);
      /* No second, fallback title call for a repair attempt. */
      expect(addTitle).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('a Stop cancels the title only while the run has not started', () => {
  const stopScenarios = [
    ['Stop deleted the job (abortJob cleanup)', undefined],
    ['Stop left the job in place', { createdAt: JOB_CREATED_AT }],
  ];

  it.each(stopScenarios)(
    'run already started — %s: the title finishes',
    async (_name, jobAfter) => {
      let titleSignal;
      const addTitle = jest.fn(async (_req, params) => {
        titleSignal = params.signal;
        return 'Погода в Минске';
      });
      let job;
      const client = makeClient(async (self, options) => {
        self.run = {};
        await flush();
        job.abortController.abort();
        mockGenerationJobManager.getJob.mockResolvedValue(jobAfter);
        return response(options.conversationId);
      });
      mockGenerationJobManager.createJob.mockImplementation(async () => job);
      job = {
        createdAt: JOB_CREATED_AT,
        readyPromise: Promise.resolve(),
        abortController: new AbortController(),
        emitter: { on: jest.fn() },
      };

      const turnEnded = deferred();
      mockDisposeClient.mockImplementation(() => turnEnded.resolve());
      await AgentController(
        {
          user: { id: 'user-1' },
          body: {
            text: 'какая погода в минске',
            messageId: 'user-msg-1',
            parentMessageId: NO_PARENT,
            conversationId: 'new',
            endpointOption: { endpoint: 'agents', model_parameters: { model: 'm' } },
          },
          config: {},
        },
        makeRes(),
        jest.fn(),
        jest.fn(async () => ({ client })),
        addTitle,
      );
      await turnEnded.promise;

      expect(addTitle).toHaveBeenCalledTimes(1);
      expect(titleSignal.aborted).toBe(false);
    },
  );

  it('run never started: the title is cancelled, so nothing waits for a run that will not come', async () => {
    let titleSignal;
    const addTitle = jest.fn(async (_req, params) => {
      titleSignal = params.signal;
      return undefined;
    });
    let job;
    const client = makeClient(async (_self, options) => {
      job.abortController.abort();
      mockGenerationJobManager.getJob.mockResolvedValue(undefined);
      return response(options.conversationId);
    });
    job = {
      createdAt: JOB_CREATED_AT,
      readyPromise: Promise.resolve(),
      abortController: new AbortController(),
      emitter: { on: jest.fn() },
    };
    mockGenerationJobManager.createJob.mockImplementation(async () => job);

    const turnEnded = deferred();
    mockDisposeClient.mockImplementation(() => turnEnded.resolve());
    await AgentController(
      {
        user: { id: 'user-1' },
        body: {
          text: 'какая погода в минске',
          messageId: 'user-msg-1',
          parentMessageId: NO_PARENT,
          conversationId: 'new',
          endpointOption: { endpoint: 'agents', model_parameters: { model: 'm' } },
        },
        config: {},
      },
      makeRes(),
      jest.fn(),
      jest.fn(async () => ({ client })),
      addTitle,
    );
    await turnEnded.promise;

    expect(titleSignal.aborted).toBe(true);
  });

  it('a failure before the run started cancels the title as well', async () => {
    let titleSignal;
    const addTitle = jest.fn(async (_req, params) => {
      titleSignal = params.signal;
      return undefined;
    });
    const client = makeClient(async () => {
      throw new Error('quota exceeded before the run');
    });

    const { turnEnded } = await runTurn({
      body: { text: 'какая погода в минске', conversationId: 'new' },
      client,
      addTitle,
    });
    await turnEnded;

    expect(titleSignal.aborted).toBe(true);
  });
});
