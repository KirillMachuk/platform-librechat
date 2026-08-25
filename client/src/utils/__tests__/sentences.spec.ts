import { splitThinkSentences } from '../sentences';

describe('splitThinkSentences (cards К4 stream preview)', () => {
  it('splits on sentence enders followed by whitespace or end of line', () => {
    expect(splitThinkSentences('Первое предложение. Второе! Третье?')).toEqual([
      'Первое предложение.',
      'Второе!',
      'Третье?',
    ]);
  });

  it('keeps decimals and abbreviations whole', () => {
    expect(splitThinkSentences('Число 3.14 внутри. Дальше текст.')).toEqual([
      'Число 3.14 внутри.',
      'Дальше текст.',
    ]);
  });

  it('treats newlines as breaks and drops empty lines', () => {
    expect(splitThinkSentences('Строка один\n\nСтрока два. Хвост')).toEqual([
      'Строка один',
      'Строка два.',
      'Хвост',
    ]);
  });

  it('keeps an ellipsis with its sentence', () => {
    expect(splitThinkSentences('Думаю... Дальше. И ещё…')).toEqual([
      'Думаю...',
      'Дальше.',
      'И ещё…',
    ]);
  });

  it('is prefix-stable: appending text never rewrites earlier sentences', () => {
    const full = 'Первое предложение целиком. Второе растёт прямо сей';
    const prefixes = [10, 20, 30, full.length].map((n) => full.slice(0, n));
    let previous: string[] = [];
    for (const prefix of prefixes) {
      const current = splitThinkSentences(prefix);
      for (let i = 0; i < previous.length - 1; i++) {
        expect(current[i]).toBe(previous[i]);
      }
      previous = current;
    }
  });
});
