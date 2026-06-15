import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createAnalyticsTopicsMethods } from './analyticsTopics';
import { tenantStorage } from '~/config/tenantContext';
import { createModels } from '~/models';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

let mongoServer: InstanceType<typeof MongoMemoryServer>;
let Conversation: mongoose.Model<Record<string, unknown>>;
let Message: mongoose.Model<Record<string, unknown>>;
let AnalyticsRun: mongoose.Model<Record<string, unknown>>;
let AnalyticsTopic: mongoose.Model<Record<string, unknown>>;
let methods: ReturnType<typeof createAnalyticsTopicsMethods>;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const models = createModels(mongoose);
  Object.assign(mongoose.models, models);
  Conversation = mongoose.models.Conversation;
  Message = mongoose.models.Message;
  AnalyticsRun = mongoose.models.AnalyticsRun;
  AnalyticsTopic = mongoose.models.AnalyticsTopic;
  methods = createAnalyticsTopicsMethods(mongoose);
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
});

describe('assembleConversationsForClustering', () => {
  beforeEach(async () => {
    await Conversation.create([
      {
        conversationId: 'c1',
        title: 'Договор аренды',
        user: 'u1',
        tenantId: 't1',
        endpoint: 'openai',
        createdAt: new Date('2026-05-01'),
      },
      {
        conversationId: 'c2',
        title: 'Отчёт',
        user: 'u2',
        tenantId: 't1',
        endpoint: 'openai',
        createdAt: new Date('2026-05-02'),
      },
      {
        conversationId: 'c3',
        title: 'Чужой тенант',
        user: 'u9',
        tenantId: 't2',
        endpoint: 'openai',
        createdAt: new Date('2026-05-02'),
      },
    ]);
    await Message.create([
      {
        messageId: 'c1-1',
        conversationId: 'c1',
        user: 'u1',
        isCreatedByUser: true,
        text: 'изучи договор',
        tenantId: 't1',
        createdAt: new Date('2026-05-01T10:00:00Z'),
      },
      {
        messageId: 'c1-2',
        conversationId: 'c1',
        user: 'u1',
        isCreatedByUser: true,
        text: 'какие риски',
        tenantId: 't1',
        createdAt: new Date('2026-05-01T10:01:00Z'),
      },
      {
        messageId: 'c1-3',
        conversationId: 'c1',
        user: 'u1',
        isCreatedByUser: true,
        text: 'четвёртая реплика',
        tenantId: 't1',
        createdAt: new Date('2026-05-01T10:02:00Z'),
      },
      {
        messageId: 'c1-a',
        conversationId: 'c1',
        user: 'u1',
        isCreatedByUser: false,
        text: 'ответ ассистента',
        tenantId: 't1',
        createdAt: new Date('2026-05-01T10:00:30Z'),
      },
      {
        messageId: 'c2-1',
        conversationId: 'c2',
        user: 'u2',
        isCreatedByUser: true,
        text: 'сделай отчёт',
        tenantId: 't1',
        createdAt: new Date('2026-05-02T10:00:00Z'),
      },
      {
        messageId: 'c3-1',
        conversationId: 'c3',
        user: 'u9',
        isCreatedByUser: true,
        text: 'секрет другого тенанта',
        tenantId: 't2',
        createdAt: new Date('2026-05-02T10:00:00Z'),
      },
    ]);
  });

  test('assembles title + first employee turns (assistant turns excluded)', async () => {
    const out = await methods.assembleConversationsForClustering(
      { tenantId: 't1' },
      { maxUserTurns: 2 },
    );
    const c1 = out.find((c) => c.conversationId === 'c1');
    expect(c1).toBeDefined();
    // title + first 2 user turns; the third turn and the assistant turn are excluded.
    expect(c1?.text).toBe('Договор аренды\nизучи договор\nкакие риски');
    expect(c1?.userId).toBe('u1');
  });

  test('is tenant-scoped: never pulls another tenant’s conversations', async () => {
    const out = await methods.assembleConversationsForClustering({ tenantId: 't1' }, {});
    expect(out.map((c) => c.conversationId).sort()).toEqual(['c1', 'c2']);
  });

  test('respects the conversation window', async () => {
    const out = await methods.assembleConversationsForClustering(
      { tenantId: 't1', from: new Date('2026-05-02') },
      {},
    );
    expect(out.map((c) => c.conversationId)).toEqual(['c2']);
  });

  test('drops conversations that reduce to empty text', async () => {
    await Conversation.create({
      conversationId: 'c4',
      title: '',
      user: 'u1',
      tenantId: 't1',
      endpoint: 'openai',
      createdAt: new Date('2026-05-03'),
    });
    // c4 has a blank title and no user messages → empty → excluded.
    const out = await methods.assembleConversationsForClustering({ tenantId: 't1' }, {});
    expect(out.map((c) => c.conversationId)).not.toContain('c4');
  });
});

describe('run lifecycle (lease/claim)', () => {
  test('claim marks running + sets a lease; a second immediate claim finds nothing', async () => {
    await methods.createAnalyticsRun({ tenantId: 't1', trigger: 'manual' });
    const claimed = await methods.claimNextAnalyticsRun(60000);
    expect(claimed?.status).toBe('running');
    expect(claimed?.attempts).toBe(1);
    expect(claimed?.leaseExpiresAt).toBeInstanceOf(Date);

    const again = await methods.claimNextAnalyticsRun(60000);
    expect(again).toBeNull();
  });

  test('an expired lease is re-claimable (crashed worker recovery)', async () => {
    const run = await methods.createAnalyticsRun({ trigger: 'scheduled' });
    await methods.claimNextAnalyticsRun(60000);
    // Simulate a crashed worker: force the lease into the past.
    await AnalyticsRun.updateOne(
      { _id: run._id },
      { $set: { leaseExpiresAt: new Date(Date.now() - 1000) } },
    );
    const reclaimed = await methods.claimNextAnalyticsRun(60000);
    expect(reclaimed?._id?.toString()).toBe(run._id?.toString());
    expect(reclaimed?.attempts).toBe(2);
  });

  test('complete records stats; fail records a (clamped) error; getLatest returns newest done', async () => {
    const r1 = await methods.createAnalyticsRun({ tenantId: 't1' });
    await methods.completeAnalyticsRun(r1._id, { conversationCount: 10, topicCount: 3 });
    const r2 = await methods.createAnalyticsRun({ tenantId: 't1' });
    await methods.failAnalyticsRun(r2._id, new Error('boom'));

    const latest = await methods.getLatestAnalyticsRun({ tenantId: 't1' });
    expect(latest?._id?.toString()).toBe(r1._id?.toString());
    expect(latest?.status).toBe('done');
    expect(latest?.conversationCount).toBe(10);

    const failed = await AnalyticsRun.findById(r2._id).lean<{ status: string; error: string }>();
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toBe('boom');
  });
});

describe('results persistence', () => {
  test('saveRunResults replaces prior results idempotently; reads are sorted', async () => {
    const run = await methods.createAnalyticsRun({ tenantId: 't1' });
    await methods.saveRunResults(
      run._id,
      [
        {
          topicKey: 0,
          label: 'Договоры',
          keywords: ['договор'],
          size: 5,
          share: 0.5,
          representativeConversationIds: ['c1'],
        },
        {
          topicKey: 1,
          label: 'Отчёты',
          keywords: ['отчёт'],
          size: 3,
          share: 0.3,
          representativeConversationIds: ['c2'],
        },
      ],
      [
        {
          conversationId: 'c1',
          topicKey: 0,
          userId: 'u1',
          conversationCreatedAt: new Date('2026-05-01'),
        },
        {
          conversationId: 'c2',
          topicKey: 1,
          userId: 'u2',
          conversationCreatedAt: new Date('2026-05-02'),
        },
      ],
    );

    const topics = await methods.getRunTopics(run._id);
    expect(topics.map((t) => t.topicKey)).toEqual([0, 1]); // size desc
    expect(topics[0].label).toBe('Договоры');

    const assignments = await methods.getTopicAssignments(run._id, 0, { limit: 10, offset: 0 });
    expect(assignments.map((a) => a.conversationId)).toEqual(['c1']);

    // Re-save with fewer results → prior ones are gone (idempotent replace).
    await methods.saveRunResults(
      run._id,
      [
        {
          topicKey: 0,
          label: 'Только договоры',
          keywords: ['договор'],
          size: 5,
          share: 1,
          representativeConversationIds: [],
        },
      ],
      [{ conversationId: 'c1', topicKey: 0, userId: 'u1' }],
    );
    const topics2 = await methods.getRunTopics(run._id);
    expect(topics2).toHaveLength(1);
    expect(topics2[0].label).toBe('Только договоры');
  });

  test('tenant isolation: results saved under one tenant are invisible to another', async () => {
    const run = await tenantStorage.run({ tenantId: 't1' } as never, async () => {
      const r = await methods.createAnalyticsRun({});
      await methods.saveRunResults(
        r._id,
        [
          {
            topicKey: 0,
            label: 'T1',
            keywords: [],
            size: 1,
            share: 1,
            representativeConversationIds: [],
          },
        ],
        [{ conversationId: 'c1', topicKey: 0 }],
      );
      return r;
    });

    // Same run id, but queried under tenant t2 → tenant isolation hides it.
    const leaked = await tenantStorage.run({ tenantId: 't2' } as never, async () =>
      methods.getRunTopics(run._id),
    );
    expect(leaked).toHaveLength(0);

    // Stamped with t1 (visible within t1).
    const stamped = await AnalyticsTopic.findOne({ runId: run._id }).lean<{ tenantId: string }>();
    expect(stamped?.tenantId).toBe('t1');
  });
});

describe('getConversationSummaries (drill-in)', () => {
  beforeEach(async () => {
    await Conversation.create([
      {
        conversationId: 's1',
        title: 'Договор аренды',
        user: 'u1',
        tenantId: 't1',
        endpoint: 'openai',
        createdAt: new Date('2026-05-01'),
      },
      {
        conversationId: 's2',
        title: 'Отчёт',
        user: 'u2',
        tenantId: 't1',
        endpoint: 'openai',
        createdAt: new Date('2026-05-02'),
      },
      {
        conversationId: 's3',
        title: 'Другой тенант',
        user: 'u9',
        tenantId: 't2',
        endpoint: 'openai',
        createdAt: new Date('2026-05-02'),
      },
    ]);
    await Message.create([
      {
        messageId: 's1-1',
        conversationId: 's1',
        user: 'u1',
        isCreatedByUser: true,
        text: 'изучи договор аренды',
        tenantId: 't1',
        createdAt: new Date('2026-05-01T10:00:00Z'),
      },
      {
        messageId: 's1-0',
        conversationId: 's1',
        user: 'u1',
        isCreatedByUser: false,
        text: 'ответ',
        tenantId: 't1',
        createdAt: new Date('2026-05-01T10:00:30Z'),
      },
      {
        messageId: 's2-1',
        conversationId: 's2',
        user: 'u2',
        isCreatedByUser: true,
        text: 'сделай отчёт',
        tenantId: 't1',
        createdAt: new Date('2026-05-02T10:00:00Z'),
      },
      {
        messageId: 's3-1',
        conversationId: 's3',
        user: 'u9',
        isCreatedByUser: true,
        text: 'секрет',
        tenantId: 't2',
        createdAt: new Date('2026-05-02T10:00:00Z'),
      },
    ]);
  });

  test('returns title + first user-request preview, preserving the input order', async () => {
    const out = await methods.getConversationSummaries(['s2', 's1'], 't1');
    expect(out.map((s) => s.conversationId)).toEqual(['s2', 's1']);
    const s1 = out.find((s) => s.conversationId === 's1');
    expect(s1).toMatchObject({ title: 'Договор аренды', preview: 'изучи договор аренды' });
  });

  test('is tenant-scoped: another tenant’s conversation is not returned', async () => {
    const out = await methods.getConversationSummaries(['s1', 's3'], 't1');
    expect(out.map((s) => s.conversationId)).toEqual(['s1']);
  });
});
