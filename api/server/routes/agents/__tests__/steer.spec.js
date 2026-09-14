/**
 * POST /chat/steer — mid-run clarifications for a running Deep Research job
 * (DR_MIDRUN_STEERING_Plan.md). Same mock skeleton as abort.spec.js; the
 * mailbox is the REAL one so the route's contract with it is what is tested.
 */

const express = require('express');
const request = require('supertest');

const mockLogger = { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() };
const mockGenerationJobManager = {
  getJob: jest.fn(),
  abortJob: jest.fn(),
  getActiveJobIdsForUser: jest.fn(),
};
const mockSaveMessage = jest.fn();
const mockGetSteering = jest.fn();

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: mockLogger,
}));

jest.mock('@librechat/api', () => ({
  ...jest.requireActual('@librechat/api'),
  isEnabled: jest.fn().mockReturnValue(false),
  GenerationJobManager: mockGenerationJobManager,
  getSteering: (...args) => mockGetSteering(...args),
}));

jest.mock('~/models', () => ({
  saveMessage: (...args) => mockSaveMessage(...args),
}));

jest.mock('~/server/middleware', () => ({
  uaParser: (req, res, next) => next(),
  checkBan: (req, res, next) => next(),
  requireJwtAuth: (req, res, next) => {
    req.user = { id: 'test-user-123' };
    next();
  },
  messageIpLimiter: (req, res, next) => next(),
  configMiddleware: (req, res, next) => next(),
  messageUserLimiter: (req, res, next) => next(),
}));

jest.mock('~/server/routes/agents/chat', () => require('express').Router());
jest.mock('~/server/routes/agents/v1', () => ({ v1: require('express').Router() }));

const { SteeringMailbox, MAX_STEER_CHARS, MAX_STEERS_PER_RUN } =
  jest.requireActual('@librechat/api');
const agentRoutes = require('~/server/routes/agents/index');

const CONVO = 'c1';

describe('POST /chat/steer', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/agents', agentRoutes);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockGenerationJobManager.getJob.mockResolvedValue({
      status: 'running',
      metadata: { userId: 'test-user-123', endpoint: '1ma' },
    });
    mockSaveMessage.mockImplementation(async (ctx, msg) => msg);
  });

  const steer = (body) => request(app).post('/api/agents/chat/steer').send(body);

  it('persists the clarification under the branch head, hands the mailbox its text, and moves the head', async () => {
    const box = new SteeringMailbox({ headMessageId: 'um1' });
    mockGetSteering.mockReturnValue(box);

    const first = await steer({ conversationId: CONVO, text: '  не Минск, а вся область ' });
    expect(first.status).toBe(200);
    expect(first.body.parentMessageId).toBe('um1');
    expect(first.body.accepted).toBe(1);
    expect(first.body.message).toMatchObject({
      conversationId: CONVO,
      parentMessageId: 'um1',
      text: 'не Минск, а вся область',
      isCreatedByUser: true,
      sender: 'User',
      user: 'test-user-123',
      endpoint: '1ma',
      drKind: 'steer',
    });
    expect(mockSaveMessage).toHaveBeenCalledTimes(1);
    expect(mockSaveMessage.mock.calls[0][0]).toEqual({
      userId: 'test-user-123',
      isTemporary: undefined,
      interfaceConfig: undefined,
    });
    expect(box.texts()).toEqual(['не Минск, а вся область']);
    expect(box.headMessageId).toBe(first.body.message.messageId);

    /* The second one chains under the first: question → steer₁ → steer₂ → answer. */
    const second = await steer({ conversationId: CONVO, text: 'и только 2026 год' });
    expect(second.status).toBe(200);
    expect(second.body.parentMessageId).toBe(first.body.message.messageId);
    expect(box.messages().map((m) => m.messageId)).toEqual([
      first.body.message.messageId,
      second.body.message.messageId,
    ]);
  });

  it('hands the graph the MASKED text and the chat the raw one (sovereign)', async () => {
    const box = new SteeringMailbox({
      headMessageId: 'um1',
      mask: async (text) => text.replace('Иванов', '[PERSON_1]'),
    });
    mockGetSteering.mockReturnValue(box);
    const res = await steer({ conversationId: CONVO, text: 'Иванов — не тот' });
    expect(res.status).toBe(200);
    expect(box.texts()).toEqual(['[PERSON_1] — не тот']);
    expect(mockSaveMessage.mock.calls[0][1].text).toBe('Иванов — не тот');
  });

  it('refuses with 503 and stores NOTHING when masking fails', async () => {
    const box = new SteeringMailbox({
      headMessageId: 'um1',
      mask: async () => {
        throw new Error('anonymizer down');
      },
    });
    mockGetSteering.mockReturnValue(box);
    const res = await steer({ conversationId: CONVO, text: 'Иванов — не тот' });
    expect(res.status).toBe(503);
    expect(res.body.reason).toBe('mask');
    expect(res.body.error).toMatch(/Анонимайзер/);
    expect(mockSaveMessage).not.toHaveBeenCalled();
    expect(box.size).toBe(0);
    expect(box.headMessageId).toBe('um1');
  });

  it('refuses once the report is being written — the run would never read it', async () => {
    const box = new SteeringMailbox({ headMessageId: 'um1' });
    box.phase = 'report';
    mockGetSteering.mockReturnValue(box);
    const res = await steer({ conversationId: CONVO, text: 'поздно' });
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('report');
    expect(res.body.error).toMatch(/Отчёт уже пишется/);
    expect(mockSaveMessage).not.toHaveBeenCalled();
  });

  it('caps the count and the length, naming the next step', async () => {
    const box = new SteeringMailbox({ headMessageId: 'um1' });
    mockGetSteering.mockReturnValue(box);
    const long = await steer({ conversationId: CONVO, text: 'x'.repeat(MAX_STEER_CHARS + 1) });
    expect(long.status).toBe(400);
    expect(long.body.reason).toBe('length');

    for (let i = 0; i < MAX_STEERS_PER_RUN; i++) {
      box.add({ text: `s${i}`, message: { messageId: `s${i}` } });
    }
    const over = await steer({ conversationId: CONVO, text: 'ещё' });
    expect(over.status).toBe(409);
    expect(over.body.reason).toBe('limit');
    expect(over.body.error).toMatch(/обычным сообщением/);
  });

  it('400 on empty text or a placeholder conversation', async () => {
    expect((await steer({ conversationId: CONVO, text: '   ' })).status).toBe(400);
    expect((await steer({ conversationId: 'new', text: 'x' })).status).toBe(400);
    expect((await steer({ text: 'x' })).status).toBe(400);
    expect(mockGenerationJobManager.getJob).not.toHaveBeenCalled();
  });

  it('409 when no job is running — the message belongs to the next turn', async () => {
    mockGenerationJobManager.getJob.mockResolvedValue(null);
    const res = await steer({ conversationId: CONVO, text: 'x' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/обычным сообщением/);

    mockGenerationJobManager.getJob.mockResolvedValue({ status: 'complete', metadata: {} });
    expect((await steer({ conversationId: CONVO, text: 'x' })).status).toBe(409);
  });

  it('409 when the running job has no mailbox (not a research run, or another process)', async () => {
    mockGetSteering.mockReturnValue(undefined);
    const res = await steer({ conversationId: CONVO, text: 'x' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/идущее исследование/);
    expect(mockSaveMessage).not.toHaveBeenCalled();
  });

  it("403 for another user's job, like abort", async () => {
    mockGenerationJobManager.getJob.mockResolvedValue({
      status: 'running',
      metadata: { userId: 'someone-else' },
    });
    mockGetSteering.mockReturnValue(new SteeringMailbox({ headMessageId: 'um1' }));
    const res = await steer({ conversationId: CONVO, text: 'x' });
    expect(res.status).toBe(403);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Unauthorized steer attempt'),
    );
    expect(mockSaveMessage).not.toHaveBeenCalled();
  });

  it('500 and no mailbox entry when the database refuses the message', async () => {
    const box = new SteeringMailbox({ headMessageId: 'um1' });
    mockGetSteering.mockReturnValue(box);
    mockSaveMessage.mockRejectedValue(new Error('mongo down'));
    const res = await steer({ conversationId: CONVO, text: 'x' });
    expect(res.status).toBe(500);
    expect(box.size).toBe(0);
  });
});
