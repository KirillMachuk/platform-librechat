import {
  ASK_SKIP_MARKER,
  parseAskUserArgs,
  isAskSkipMessage,
  isAskAnswersMessage,
  buildAskAnswersMessage,
  parseAskAnswersMessage,
  contentHasAskUserCall,
} from '../src/askUser';

describe('parseAskUserArgs', () => {
  it('parses a JSON string of valid questions and defaults missing ids', () => {
    const parsed = parseAskUserArgs(
      JSON.stringify({
        questions: [
          { prompt: ' Какой формат? ', options: ['Сводка', 'Отчёт'] },
          { id: 'per', prompt: 'Период?', options: ['Месяц', 'Год', ''] },
        ],
      }),
    );
    expect(parsed).toEqual([
      { id: 'q1', prompt: 'Какой формат?', options: ['Сводка', 'Отчёт'] },
      { id: 'per', prompt: 'Период?', options: ['Месяц', 'Год'] },
    ]);
  });

  it('returns null for streaming/incomplete JSON and for shapeless args', () => {
    expect(parseAskUserArgs('{"questions":[{"prom')).toBeNull();
    expect(parseAskUserArgs({})).toBeNull();
    expect(parseAskUserArgs({ questions: [] })).toBeNull();
  });

  it('drops questions with fewer than 2 options and clamps counts', () => {
    const parsed = parseAskUserArgs({
      questions: [
        { prompt: 'Один вариант', options: ['A'] },
        { prompt: 'Q1', options: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] },
        { prompt: 'Q2', options: ['A', 'B'] },
        { prompt: 'Q3', options: ['A', 'B'] },
        { prompt: 'Q4 за пределом', options: ['A', 'B'] },
      ],
    });
    expect(parsed?.map((q) => q.prompt)).toEqual(['Q1', 'Q2', 'Q3']);
    expect(parsed?.[0].options).toHaveLength(6);
  });
});

describe('answers message round-trip', () => {
  const questions = [
    { id: 'q1', prompt: 'Формат?', options: ['Сводка', 'Отчёт'] },
    { id: 'q2', prompt: 'Период?', options: ['Месяц', 'Год'] },
  ];

  it('builds the marker message and parses the pairs back', () => {
    const text = buildAskAnswersMessage(questions, { q1: 'Отчёт', q2: 'Свой период: неделя' });
    expect(isAskAnswersMessage(text)).toBe(true);
    expect(parseAskAnswersMessage(text)).toEqual([
      { prompt: 'Формат?', answer: 'Отчёт' },
      { prompt: 'Период?', answer: 'Свой период: неделя' },
    ]);
  });

  it('ordinary prose is not an answers or skip message', () => {
    expect(isAskAnswersMessage('Привет, вот мои ответы')).toBe(false);
    expect(isAskSkipMessage('Пропустить вопросы потом')).toBe(false);
    expect(isAskSkipMessage(ASK_SKIP_MARKER)).toBe(true);
  });
});

describe('contentHasAskUserCall', () => {
  it('detects the ask_user tool call and rejects other content', () => {
    expect(
      contentHasAskUserCall([
        { type: 'text' },
        { type: 'tool_call', tool_call: { name: 'ask_user' } },
      ]),
    ).toBe(true);
    expect(contentHasAskUserCall([{ type: 'tool_call', tool_call: { name: 'web_search' } }])).toBe(
      false,
    );
    expect(contentHasAskUserCall(undefined)).toBe(false);
  });
});
