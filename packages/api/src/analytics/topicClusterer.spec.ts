import type { TopicClustererDeps, ClusterResult } from './topicClusterer';
import { createTopicClusterer } from './topicClusterer';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

function clusterResult(): ClusterResult {
  return {
    topics: [
      {
        topicKey: 0,
        keywords: ['договор'],
        size: 2,
        share: 1,
        representativeConversationIds: ['c1'],
      },
    ],
    assignments: [
      {
        conversationId: 'c1',
        topicKey: 0,
        userId: 'u1',
        conversationCreatedAt: '2026-05-01T00:00:00.000Z',
        score: 0.9,
      },
      { conversationId: 'c2', topicKey: 0, userId: 'u2' },
    ],
    stats: { conversations: 2, topics: 1, assigned: 2, noise: 0 },
  };
}

function makeDeps(overrides: Partial<TopicClustererDeps> = {}): TopicClustererDeps {
  return {
    assembleConversationsForClustering: jest.fn().mockResolvedValue([
      {
        conversationId: 'c1',
        text: 'изучи договор',
        userId: 'u1',
        createdAt: new Date('2026-05-01'),
      },
      { conversationId: 'c2', text: 'договор аренды', userId: 'u2' },
    ]),
    clusterConversations: jest.fn().mockResolvedValue(clusterResult()),
    createAnalyticsRun: jest.fn().mockResolvedValue({ _id: 'run1' }),
    saveRunResults: jest.fn().mockResolvedValue(undefined),
    completeAnalyticsRun: jest.fn().mockResolvedValue(undefined),
    failAnalyticsRun: jest.fn().mockResolvedValue(undefined),
    getLatestAnalyticsRun: jest.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe('createTopicClusterer', () => {
  it('runs end-to-end: assemble → cluster → save → complete', async () => {
    const deps = makeDeps();
    const clusterer = createTopicClusterer(deps);

    await clusterer.runClustering({
      tenantId: 't1',
      from: new Date('2026-03-01'),
      trigger: 'manual',
    });

    expect(deps.createAnalyticsRun).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1', trigger: 'manual' }),
    );
    expect(deps.clusterConversations).toHaveBeenCalledTimes(1);
    // createdAt is normalised to an ISO string for the service.
    const sent = (deps.clusterConversations as jest.Mock).mock.calls[0][0];
    expect(sent[0]).toMatchObject({ conversationId: 'c1', createdAt: '2026-05-01T00:00:00.000Z' });

    // results saved with conversationCreatedAt parsed back to a Date.
    const [, topics, assignments] = (deps.saveRunResults as jest.Mock).mock.calls[0];
    expect(topics[0].keywords).toEqual(['договор']);
    expect(assignments[0].conversationCreatedAt).toBeInstanceOf(Date);
    expect(deps.completeAnalyticsRun).toHaveBeenCalledWith(
      'run1',
      expect.objectContaining({
        conversationCount: 2,
        topicCount: 1,
        assignedCount: 2,
        noiseCount: 0,
      }),
    );
    expect(deps.failAnalyticsRun).not.toHaveBeenCalled();
  });

  it('short-circuits to a zeroed run when the window has no conversations', async () => {
    const deps = makeDeps({ assembleConversationsForClustering: jest.fn().mockResolvedValue([]) });
    const clusterer = createTopicClusterer(deps);

    await clusterer.runClustering({ tenantId: 't1' });

    expect(deps.clusterConversations).not.toHaveBeenCalled();
    expect(deps.completeAnalyticsRun).toHaveBeenCalledWith('run1', {
      conversationCount: 0,
      topicCount: 0,
      assignedCount: 0,
      noiseCount: 0,
    });
  });

  it('marks the run failed and rethrows when clustering errors', async () => {
    const deps = makeDeps({
      clusterConversations: jest.fn().mockRejectedValue(new Error('topics down')),
    });
    const clusterer = createTopicClusterer(deps);

    await expect(clusterer.runClustering({ tenantId: 't1' })).rejects.toThrow('topics down');
    expect(deps.failAnalyticsRun).toHaveBeenCalledWith('run1', expect.any(Error));
    expect(deps.completeAnalyticsRun).not.toHaveBeenCalled();
  });

  describe('runIfStale', () => {
    it('skips when a recent completed run exists', async () => {
      const deps = makeDeps({
        getLatestAnalyticsRun: jest.fn().mockResolvedValue({ _id: 'r0', createdAt: new Date() }),
      });
      const clusterer = createTopicClusterer(deps);

      const result = await clusterer.runIfStale({ tenantId: 't1', minIntervalMs: 60_000 });

      expect(result).toBeNull();
      expect(deps.createAnalyticsRun).not.toHaveBeenCalled();
    });

    it('runs when the latest run is older than the interval', async () => {
      const deps = makeDeps({
        getLatestAnalyticsRun: jest
          .fn()
          .mockResolvedValue({ _id: 'r0', createdAt: new Date(Date.now() - 2 * 60_000) }),
      });
      const clusterer = createTopicClusterer(deps);

      await clusterer.runIfStale({ tenantId: 't1', minIntervalMs: 60_000 });

      expect(deps.createAnalyticsRun).toHaveBeenCalledTimes(1);
      expect(deps.clusterConversations).toHaveBeenCalledTimes(1);
    });

    it('runs when there is no prior run', async () => {
      const deps = makeDeps();
      const clusterer = createTopicClusterer(deps);

      await clusterer.runIfStale({ tenantId: 't1', minIntervalMs: 60_000 });

      expect(deps.createAnalyticsRun).toHaveBeenCalledTimes(1);
    });
  });

  describe('labeling', () => {
    it('applies labelTopics and saves the labeled topics', async () => {
      const labelTopics = jest
        .fn()
        .mockImplementation((topics) =>
          Promise.resolve(topics.map((t: { topicKey: number }) => ({ ...t, label: 'Договоры' }))),
        );
      const deps = makeDeps({ labelTopics });
      const clusterer = createTopicClusterer(deps);

      await clusterer.runClustering({ tenantId: 't1' });

      expect(labelTopics).toHaveBeenCalledTimes(1);
      const [, savedTopics] = (deps.saveRunResults as jest.Mock).mock.calls[0];
      expect(savedTopics[0].label).toBe('Договоры');
    });

    it('degrades to keyword-only topics when labeling throws (run still completes)', async () => {
      const labelTopics = jest.fn().mockRejectedValue(new Error('label step down'));
      const deps = makeDeps({ labelTopics });
      const clusterer = createTopicClusterer(deps);

      await clusterer.runClustering({ tenantId: 't1' });

      const [, savedTopics] = (deps.saveRunResults as jest.Mock).mock.calls[0];
      expect(savedTopics[0].label).toBeUndefined();
      expect(deps.completeAnalyticsRun).toHaveBeenCalled();
      expect(deps.failAnalyticsRun).not.toHaveBeenCalled();
    });
  });
});
