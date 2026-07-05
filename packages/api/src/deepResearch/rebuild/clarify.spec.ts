import {
  CLARIFY_MARKER,
  buildClarifyPrompt,
  parseClarifyOutput,
  formatClarifyMessage,
  isClarifyMessage,
} from './clarify';

describe('parseClarifyOutput (fail-open to PROCEED)', () => {
  it('returns CLARIFY with trimmed questions when the model asks', () => {
    const out = parseClarifyOutput(
      '{"action":"CLARIFY","questions":[" Масштаб бизнеса? ","Бюджет?"]}',
    );
    expect(out.action).toBe('CLARIFY');
    expect(out.questions).toEqual(['Масштаб бизнеса?', 'Бюджет?']);
  });

  it('caps at 3 questions and drops empty ones', () => {
    const out = parseClarifyOutput('{"action":"CLARIFY","questions":["a","","b","c","d"]}');
    expect(out.questions).toEqual(['a', 'b', 'c']);
  });

  it('returns PROCEED for an explicit PROCEED', () => {
    expect(parseClarifyOutput('{"action":"PROCEED","questions":[]}').action).toBe('PROCEED');
  });

  it('fails open to PROCEED on garbage / non-JSON / CLARIFY-without-questions', () => {
    expect(parseClarifyOutput('not json at all').action).toBe('PROCEED');
    expect(parseClarifyOutput('').action).toBe('PROCEED');
    expect(parseClarifyOutput('{"action":"CLARIFY","questions":[]}').action).toBe('PROCEED');
    expect(parseClarifyOutput('{"action":"CLARIFY"}').action).toBe('PROCEED');
  });

  it('parses JSON embedded in prose / code fences', () => {
    const out = parseClarifyOutput(
      'Вот ответ:\n```json\n{"action":"CLARIFY","questions":["X?"]}\n```',
    );
    expect(out).toEqual({ action: 'CLARIFY', questions: ['X?'] });
  });
});

describe('buildClarifyPrompt', () => {
  it('asks for the PROCEED/CLARIFY JSON and honors an explicit "начинай"', () => {
    const prompt = buildClarifyPrompt({ now: '2026-07-05' });
    expect(prompt).toMatch(/PROCEED\|CLARIFY/);
    expect(prompt).toMatch(/"action"/);
    expect(prompt).toContain('начинай');
  });
});

describe('formatClarifyMessage + isClarifyMessage', () => {
  it('renders a numbered list under the marker and round-trips detection', () => {
    const msg = formatClarifyMessage(['Масштаб?', 'Бюджет?']);
    expect(msg.startsWith(CLARIFY_MARKER)).toBe(true);
    expect(msg).toContain('1. Масштаб?');
    expect(msg).toContain('2. Бюджет?');
    expect(isClarifyMessage(msg)).toBe(true);
  });

  it('isClarifyMessage is false for a normal report or empty text', () => {
    expect(isClarifyMessage('## Ключевые выводы\n...')).toBe(false);
    expect(isClarifyMessage('')).toBe(false);
  });
});
