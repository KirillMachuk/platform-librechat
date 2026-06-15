import type { ClusterResult } from './topicClusterer';
import { createTopicLabeler, stripPiiKeywords } from './topicLabeler';

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

  it('strips structured-PII keywords before sending them to the LLM', async () => {
    const generateLabel = jest.fn().mockResolvedValue('Договоры');
    const { labelTopics } = createTopicLabeler({ generateLabel });

    await labelTopics([topic(0, ['договор', 'ivan@mail.ru', '+7 999 123-45-67', 'аренда'])]);

    expect(generateLabel).toHaveBeenCalledWith({ keywords: ['договор', 'аренда'] });
  });

  it('skips labeling entirely when every keyword looks like PII', async () => {
    const generateLabel = jest.fn().mockResolvedValue('x');
    const { labelTopics } = createTopicLabeler({ generateLabel });

    const out = await labelTopics([topic(0, ['ivan@mail.ru', '79991234567'])]);

    expect(out[0].label).toBeUndefined();
    expect(generateLabel).not.toHaveBeenCalled();
  });
});

describe('stripPiiKeywords', () => {
  it('keeps ordinary topic words', () => {
    expect(stripPiiKeywords(['договор', 'аренда', 'отчёт', 'НДС'])).toEqual([
      'договор',
      'аренда',
      'отчёт',
      'НДС',
    ]);
  });

  it('drops emails, urls, phones and long number runs', () => {
    expect(
      stripPiiKeywords([
        'договор',
        'ivan@mail.ru',
        'https://example.com',
        'www.site. by',
        '+7 999 123-45-67',
        '79991234567',
        '1234567', // 7-digit id
        'паспорт1234', // <6 digit run, <7 digits → kept
      ]),
    ).toEqual(['договор', 'паспорт1234']);
  });
});
