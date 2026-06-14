import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createAnalyticsMethods } from './analytics';
import { createModels } from '~/models';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

let mongoServer: InstanceType<typeof MongoMemoryServer>;
let Message: mongoose.Model<Record<string, unknown>>;
let Conversation: mongoose.Model<Record<string, unknown>>;
let User: mongoose.Model<Record<string, unknown>>;
let Agent: mongoose.Model<Record<string, unknown>>;
let methods: ReturnType<typeof createAnalyticsMethods>;

let aliceId: string;
let bobId: string;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const models = createModels(mongoose);
  Object.assign(mongoose.models, models);
  Message = mongoose.models.Message;
  Conversation = mongoose.models.Conversation;
  User = mongoose.models.User;
  Agent = mongoose.models.Agent;
  methods = createAnalyticsMethods(mongoose);
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();

  const alice = await User.create({ email: 'alice@x.io', name: 'Alice' });
  const bob = await User.create({ email: 'bob@x.io', name: 'Bob' });
  aliceId = alice._id.toString();
  bobId = bob._id.toString();

  // A real (named) agent — its display name should resolve in the feed.
  await Agent.create({
    id: 'agent-legal',
    name: 'Юрист',
    provider: 'openai',
    model: 'gpt-x',
    author: alice._id,
  });

  await Conversation.create([
    {
      conversationId: 'c1',
      title: 'Договоры',
      user: aliceId,
      agent_id: 'agent-legal',
      endpoint: 'agents',
    },
    { conversationId: 'c2', title: 'Отчёт', user: bobId, endpoint: 'openai' },
  ]);

  await Message.create([
    {
      messageId: 'm1',
      conversationId: 'c1',
      user: aliceId,
      isCreatedByUser: true,
      text: 'Составь договор аренды',
      model: 'gpt-x',
      endpoint: 'agents',
      createdAt: new Date('2026-01-01T10:00:00.000Z'),
    },
    {
      // Agent answer: top-level text is empty, the answer lives in content as `{ value }`.
      messageId: 'm1-a',
      conversationId: 'c1',
      user: aliceId,
      isCreatedByUser: false,
      sender: 'Assistant',
      content: [{ type: 'text', text: { value: 'Вот черновик договора' } }],
      model: 'gpt-x',
      endpoint: 'agents',
      createdAt: new Date('2026-01-01T10:00:05.000Z'),
    },
    {
      // Reasoning turn: text under the `think` key.
      messageId: 'm1-b',
      conversationId: 'c1',
      user: aliceId,
      isCreatedByUser: false,
      sender: 'Assistant',
      content: [{ type: 'think', think: 'рассуждение модели' }],
      createdAt: new Date('2026-01-01T10:00:06.000Z'),
    },
    {
      messageId: 'm2',
      conversationId: 'c2',
      user: bobId,
      isCreatedByUser: true,
      text: 'Сделай отчёт по продажам',
      model: 'claude-y',
      endpoint: 'openai',
      createdAt: new Date('2026-02-01T10:00:00.000Z'),
    },
  ]);
});

describe('listInteractions', () => {
  test('returns only user requests, newest first, with joined author/agent/title', async () => {
    const { interactions, hasMore } = await methods.listInteractions({}, { limit: 10, offset: 0 });

    expect(interactions).toHaveLength(2);
    expect(hasMore).toBe(false);
    expect(interactions[0]).toMatchObject({
      messageId: 'm2',
      userId: bobId,
      userEmail: 'bob@x.io',
      userName: 'Bob',
      model: 'claude-y',
      endpoint: 'openai',
      conversationTitle: 'Отчёт',
      preview: 'Сделай отчёт по продажам',
    });
    expect(interactions[1]).toMatchObject({
      messageId: 'm1',
      userEmail: 'alice@x.io',
      model: 'gpt-x',
      agentName: 'Юрист',
      conversationTitle: 'Договоры',
    });
  });

  test('ephemeral (model-as-agent) resolves to the model with no agent name', async () => {
    await Conversation.create({
      conversationId: 'c3',
      title: 'Чат с моделью',
      user: bobId,
      agent_id: '1ma__openai/gpt-5.4-mini___',
      endpoint: 'agents',
    });
    await Message.create({
      messageId: 'm3',
      conversationId: 'c3',
      user: bobId,
      isCreatedByUser: true,
      text: 'Привет',
      createdAt: new Date('2026-03-02T10:00:00.000Z'),
    });

    const { interactions } = await methods.listInteractions(
      { conversationIds: ['c3'] },
      { limit: 10, offset: 0 },
    );
    expect(interactions).toHaveLength(1);
    expect(interactions[0].model).toBe('openai/gpt-5.4-mini');
    expect(interactions[0].agentName).toBeUndefined();
  });

  test('filters by employee', async () => {
    const { interactions } = await methods.listInteractions(
      { userId: aliceId },
      { limit: 10, offset: 0 },
    );
    expect(interactions).toHaveLength(1);
    expect(interactions[0].messageId).toBe('m1');
  });

  test('filters by model and endpoint', async () => {
    const byModel = await methods.listInteractions({ model: 'gpt-x' }, { limit: 10, offset: 0 });
    expect(byModel.interactions.map((r) => r.messageId)).toEqual(['m1']);

    const byEndpoint = await methods.listInteractions(
      { endpoint: 'openai' },
      { limit: 10, offset: 0 },
    );
    expect(byEndpoint.interactions.map((r) => r.messageId)).toEqual(['m2']);
  });

  test('filters by agent (resolves conversation ids)', async () => {
    const matched = await methods.listInteractions(
      { agentId: 'agent-legal' },
      { limit: 10, offset: 0 },
    );
    expect(matched.interactions.map((r) => r.messageId)).toEqual(['m1']);

    const none = await methods.listInteractions({ agentId: 'missing' }, { limit: 10, offset: 0 });
    expect(none.interactions).toHaveLength(0);
  });

  test('accepts pre-resolved conversationIds', async () => {
    const { interactions } = await methods.listInteractions(
      { conversationIds: ['c1'] },
      { limit: 10, offset: 0 },
    );
    expect(interactions.map((r) => r.messageId)).toEqual(['m1']);
  });

  test('case-insensitive substring search over request text', async () => {
    const { interactions } = await methods.listInteractions(
      { search: 'договор' },
      { limit: 10, offset: 0 },
    );
    expect(interactions.map((r) => r.messageId)).toEqual(['m1']);
  });

  test('filters by date window', async () => {
    const { interactions } = await methods.listInteractions(
      { from: new Date('2026-01-15T00:00:00.000Z') },
      { limit: 10, offset: 0 },
    );
    expect(interactions.map((r) => r.messageId)).toEqual(['m2']);
  });

  test('paginates and reports hasMore', async () => {
    const page1 = await methods.listInteractions({}, { limit: 1, offset: 0 });
    const page2 = await methods.listInteractions({}, { limit: 1, offset: 1 });
    expect(page1.interactions.map((r) => r.messageId)).toEqual(['m2']);
    expect(page1.hasMore).toBe(true);
    expect(page2.interactions.map((r) => r.messageId)).toEqual(['m1']);
    expect(page2.hasMore).toBe(false);
  });

  test('truncates the preview to the configured length', async () => {
    const long = 'a'.repeat(500);
    await Message.create({
      messageId: 'm-long',
      conversationId: 'c2',
      user: bobId,
      isCreatedByUser: true,
      text: long,
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
    });
    const { interactions } = await methods.listInteractions(
      { search: 'aaaa' },
      { limit: 10, offset: 0 },
    );
    expect(interactions[0].preview.length).toBe(280);
  });
});

describe('countInteractions', () => {
  test('counts all user requests', async () => {
    expect(await methods.countInteractions({})).toBe(2);
  });

  test('counts with filters', async () => {
    expect(await methods.countInteractions({ userId: aliceId })).toBe(1);
    expect(await methods.countInteractions({ agentId: 'agent-legal' })).toBe(1);
    expect(await methods.countInteractions({ agentId: 'missing' })).toBe(0);
  });
});

describe('getConversationDetail', () => {
  test('returns ordered turns, resolving agent {value} answers and reasoning content', async () => {
    const detail = await methods.getConversationDetail('c1');

    expect(detail).not.toBeNull();
    expect(detail?.title).toBe('Договоры');
    expect(detail?.agentName).toBe('Юрист');
    expect(detail?.userEmail).toBe('alice@x.io');
    expect(detail?.truncated).toBe(false);
    expect(detail?.messages).toHaveLength(3);
    expect(detail?.messages[0]).toMatchObject({ messageId: 'm1', isCreatedByUser: true });
    expect(detail?.messages[1]).toMatchObject({
      messageId: 'm1-a',
      isCreatedByUser: false,
      text: 'Вот черновик договора',
    });
    expect(detail?.messages[2]).toMatchObject({
      messageId: 'm1-b',
      text: 'рассуждение модели',
    });
  });

  test('returns null for an unknown conversation', async () => {
    expect(await methods.getConversationDetail('nope')).toBeNull();
  });
});
