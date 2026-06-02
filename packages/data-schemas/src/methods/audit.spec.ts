import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { ITransaction } from '~/schema/transaction';
import { createAuditMethods } from './audit';
import { createModels } from '~/models';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

let mongoServer: InstanceType<typeof MongoMemoryServer>;
let Transaction: mongoose.Model<ITransaction>;
let Message: mongoose.Model<unknown>;
let Conversation: mongoose.Model<unknown>;
let methods: ReturnType<typeof createAuditMethods>;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const models = createModels(mongoose);
  Object.assign(mongoose.models, models);
  Transaction = mongoose.models.Transaction;
  Message = mongoose.models.Message;
  Conversation = mongoose.models.Conversation;
  methods = createAuditMethods(mongoose);
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
});

describe('recordAuditLog / getAuditLogs / countAuditLogs', () => {
  test('records an entry and reads it back', async () => {
    const actorId = new mongoose.Types.ObjectId();
    await methods.recordAuditLog({
      actorId,
      actorEmail: 'a@x.io',
      action: 'auth.login',
      ip: '127.0.0.1',
    });

    const entries = await methods.getAuditLogs({}, { limit: 10, offset: 0 });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'auth.login',
      actorEmail: 'a@x.io',
      outcome: 'success',
    });
    expect(await methods.countAuditLogs({})).toBe(1);
  });

  test('filters by action, actor and conversation; sorts newest first; paginates', async () => {
    const actorA = new mongoose.Types.ObjectId();
    const actorB = new mongoose.Types.ObjectId();
    await methods.recordAuditLog({
      actorId: actorA,
      action: 'llm.message',
      conversationId: 'c1',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await methods.recordAuditLog({
      actorId: actorA,
      action: 'llm.message',
      conversationId: 'c2',
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
    });
    await methods.recordAuditLog({
      actorId: actorB,
      action: 'auth.login',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
    });

    const byAction = await methods.getAuditLogs(
      { action: 'llm.message' },
      { limit: 10, offset: 0 },
    );
    expect(byAction).toHaveLength(2);
    expect(byAction[0].conversationId).toBe('c2'); // newest first

    const byActor = await methods.getAuditLogs(
      { actorId: actorB.toString() },
      { limit: 10, offset: 0 },
    );
    expect(byActor).toHaveLength(1);
    expect(byActor[0].action).toBe('auth.login');

    const byConvo = await methods.getAuditLogs({ conversationId: 'c1' }, { limit: 10, offset: 0 });
    expect(byConvo).toHaveLength(1);

    const page = await methods.getAuditLogs({}, { limit: 1, offset: 1 });
    expect(page).toHaveLength(1);
    expect(await methods.countAuditLogs({})).toBe(3);
  });

  test('filters by date window', async () => {
    const actor = new mongoose.Types.ObjectId();
    await methods.recordAuditLog({
      actorId: actor,
      action: 'llm.message',
      createdAt: new Date('2026-01-10T00:00:00.000Z'),
    });
    await methods.recordAuditLog({
      actorId: actor,
      action: 'llm.message',
      createdAt: new Date('2026-05-10T00:00:00.000Z'),
    });

    const windowed = await methods.getAuditLogs(
      { from: new Date('2026-05-01T00:00:00.000Z'), to: new Date('2026-06-01T00:00:00.000Z') },
      { limit: 10, offset: 0 },
    );
    expect(windowed).toHaveLength(1);
  });
});

describe('backfillAuditFromTransactions', () => {
  test('derives llm.message entries from spend transactions, idempotently', async () => {
    const userA = new mongoose.Types.ObjectId();
    await Transaction.collection.insertMany([
      {
        user: userA,
        tokenType: 'completion',
        model: 'gpt-x',
        conversationId: 'conv-1',
        messageId: 'msg-1',
        rawAmount: -300,
        tokenValue: -3000,
        createdAt: new Date('2026-03-15T00:00:00.000Z'),
      },
      {
        user: userA,
        tokenType: 'prompt',
        model: 'gpt-x',
        conversationId: 'conv-1',
        rawAmount: -200,
        tokenValue: -2000,
        createdAt: new Date('2026-03-15T00:00:00.000Z'),
      },
      // refill (credits) — must be ignored
      {
        user: userA,
        tokenType: 'credits',
        rawAmount: 10000,
        tokenValue: 10000,
        createdAt: new Date('2026-03-15T00:00:00.000Z'),
      },
    ]);

    const first = await methods.backfillAuditFromTransactions();
    expect(first).toEqual({ scanned: 2, inserted: 2 });

    const entries = await methods.getAuditLogs({ action: 'llm.message' }, { limit: 10, offset: 0 });
    expect(entries).toHaveLength(2);
    const completion = entries.find((e) => e.tokens?.output === 300);
    expect(completion?.tokens?.total).toBe(300);
    expect(completion?.conversationId).toBe('conv-1');
    expect(completion?.createdAt).toEqual(new Date('2026-03-15T00:00:00.000Z'));

    // Re-run: nothing new inserted (idempotent via sourceId)
    const second = await methods.backfillAuditFromTransactions();
    expect(second).toEqual({ scanned: 2, inserted: 0 });
    expect(await methods.countAuditLogs({ action: 'llm.message' })).toBe(2);
  });

  test('returns zero counts when there are no spend transactions', async () => {
    expect(await methods.backfillAuditFromTransactions()).toEqual({ scanned: 0, inserted: 0 });
  });

  test('only scans transactions since the given watermark', async () => {
    const user = new mongoose.Types.ObjectId();
    await Transaction.collection.insertMany([
      {
        user,
        tokenType: 'completion',
        rawAmount: -100,
        tokenValue: -1000,
        createdAt: new Date('2026-01-10T00:00:00.000Z'),
      },
      {
        user,
        tokenType: 'completion',
        rawAmount: -200,
        tokenValue: -2000,
        createdAt: new Date('2026-05-10T00:00:00.000Z'),
      },
    ]);

    const result = await methods.backfillAuditFromTransactions({
      since: new Date('2026-05-01T00:00:00.000Z'),
    });

    expect(result).toEqual({ scanned: 1, inserted: 1 });
  });
});

describe('backfillAgentInvokes', () => {
  const agentUser = new mongoose.Types.ObjectId().toString();

  async function seed() {
    await Conversation.collection.insertMany([
      { conversationId: 'c-agent', user: agentUser, agent_id: 'agent-007' },
      { conversationId: 'c-plain', user: agentUser },
    ]);
    await Message.collection.insertMany([
      // user message in an agent conversation → should produce agent.invoke
      {
        messageId: 'm1',
        conversationId: 'c-agent',
        user: agentUser,
        isCreatedByUser: true,
        model: 'gpt-x',
        createdAt: new Date('2026-03-15T10:00:00.000Z'),
      },
      // assistant reply in the agent conversation → ignored (not user-created)
      {
        messageId: 'm2',
        conversationId: 'c-agent',
        user: agentUser,
        isCreatedByUser: false,
        createdAt: new Date('2026-03-15T10:00:01.000Z'),
      },
      // user message in a non-agent conversation → ignored (no agent_id)
      {
        messageId: 'm3',
        conversationId: 'c-plain',
        user: agentUser,
        isCreatedByUser: true,
        createdAt: new Date('2026-03-15T10:00:02.000Z'),
      },
    ]);
  }

  test('derives agent.invoke only from user messages in agent conversations, idempotently', async () => {
    await seed();

    const first = await methods.backfillAgentInvokes();
    expect(first).toEqual({ scanned: 1, inserted: 1 });

    const entries = await methods.getAuditLogs(
      { action: 'agent.invoke' },
      { limit: 10, offset: 0 },
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'agent.invoke',
      targetType: 'agent',
      targetId: 'agent-007',
      conversationId: 'c-agent',
      messageId: 'm1',
    });
    expect(entries[0].actorId?.toString()).toBe(agentUser);
    expect(entries[0].createdAt).toEqual(new Date('2026-03-15T10:00:00.000Z'));

    // Re-run: idempotent via agent:<messageId> sourceId
    const second = await methods.backfillAgentInvokes();
    expect(second).toEqual({ scanned: 1, inserted: 0 });
    expect(await methods.countAuditLogs({ action: 'agent.invoke' })).toBe(1);
  });

  test('returns zero counts when there are no agent conversations', async () => {
    await Conversation.collection.insertOne({ conversationId: 'c-plain', user: agentUser });
    await Message.collection.insertOne({
      messageId: 'mx',
      conversationId: 'c-plain',
      user: agentUser,
      isCreatedByUser: true,
      createdAt: new Date('2026-03-15T10:00:00.000Z'),
    });
    expect(await methods.backfillAgentInvokes()).toEqual({ scanned: 0, inserted: 0 });
  });
});
