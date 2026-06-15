import type { ClusterResult } from './topicClusterer';
import { createTopicLabeler } from './topicLabeler';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

type Topic = ClusterResult['topics'][number];

function topic(key: number, keywords: string[]): Topic {
  return { topicKey: key, keywords, size: 5, share: 0.5, representativeConversationIds: [] };
}

describe('createTopicLabeler', () => {
  it('labels each topic from its keywords', async () => {
    const generateLabel = jest
      .fn()
      .mockImplementation(({ keywords }: { keywords: string[] }) =>
        Promise.resolve(`тема: ${keywords[0]}`),
      );
    const { labelTopics } = createTopicLabeler({ generateLabel });

    const out = await labelTopics([topic(0, ['договор']), topic(1, ['отчёт'])]);

    expect(out[0].label).toBe('тема: договор');
    expect(out[1].label).toBe('тема: отчёт');
    expect(generateLabel).toHaveBeenCalledTimes(2);
  });

  it('cleans the label (strips quotes/spaces, caps length)', async () => {
    const generateLabel = jest.fn().mockResolvedValue('  «Анализ договоров».  ');
    const { labelTopics } = createTopicLabeler({ generateLabel });

    const [out] = await labelTopics([topic(0, ['договор'])]);
    expect(out.label).toBe('Анализ договоров');
  });

  it('keeps a topic keyword-only when the label is empty or the call fails', async () => {
    const generateLabel = jest
      .fn()
      .mockResolvedValueOnce('') // empty → no label
      .mockRejectedValueOnce(new Error('llm down')); // failure → no label, no throw
    const { labelTopics } = createTopicLabeler({ generateLabel });

    const out = await labelTopics([topic(0, ['a']), topic(1, ['b'])]);
    expect(out[0].label).toBeUndefined();
    expect(out[1].label).toBeUndefined();
  });

  it('skips topics without keywords and never calls the LLM for them', async () => {
    const generateLabel = jest.fn().mockResolvedValue('x');
    const { labelTopics } = createTopicLabeler({ generateLabel });

    const out = await labelTopics([topic(0, [])]);
    expect(out[0].label).toBeUndefined();
    expect(generateLabel).not.toHaveBeenCalled();
  });

  it('isolates a single failure — other topics still get labeled', async () => {
    const generateLabel = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue('ok');
    const { labelTopics } = createTopicLabeler({ generateLabel, concurrency: 1 });

    const out = await labelTopics([topic(0, ['a']), topic(1, ['b'])]);
    expect(out[0].label).toBeUndefined();
    expect(out[1].label).toBe('ok');
  });
});
