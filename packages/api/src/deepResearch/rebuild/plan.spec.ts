import {
  PLAN_MARKER,
  START_MARKER,
  CANCEL_MARKER,
  MAX_PLAN_STEPS,
  isPlanMessage,
  buildPlanPrompt,
  isStartCommand,
  isCancelCommand,
  formatPlanMessage,
  CANCELLED_MESSAGE,
  parsePlanDecision,
} from './plan';

describe('parsePlanDecision (fail-open to PROCEED)', () => {
  it('returns CLARIFY with trimmed questions when the model asks', () => {
    const out = parsePlanDecision('{"action":"CLARIFY","questions":[" Масштаб? ","Бюджет?"]}');
    expect(out.action).toBe('CLARIFY');
    expect(out.questions).toEqual(['Масштаб?', 'Бюджет?']);
    expect(out.steps).toEqual([]);
  });

  it('returns PLAN with title + steps', () => {
    const out = parsePlanDecision(
      '{"action":"PLAN","title":"Рынок CRM в СНГ","steps":["Собрать вендоров","Сравнить цены","Сформировать таблицу"]}',
    );
    expect(out.action).toBe('PLAN');
    expect(out.title).toBe('Рынок CRM в СНГ');
    expect(out.steps).toEqual(['Собрать вендоров', 'Сравнить цены', 'Сформировать таблицу']);
    expect(out.questions).toEqual([]);
  });

  it('caps steps at MAX_PLAN_STEPS, dedupes, drops empties', () => {
    const raw = ['a', '', 'a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const out = parsePlanDecision(JSON.stringify({ action: 'PLAN', title: 'T', steps: raw }));
    expect(out.steps).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(out.steps.length).toBe(MAX_PLAN_STEPS);
  });

  it('caps clarify questions at 3 and drops empties', () => {
    const out = parsePlanDecision('{"action":"CLARIFY","questions":["a","","b","c","d"]}');
    expect(out.questions).toEqual(['a', 'b', 'c']);
  });

  it('returns PROCEED for an explicit PROCEED', () => {
    expect(parsePlanDecision('{"action":"PROCEED"}').action).toBe('PROCEED');
  });

  it('fails open to PROCEED on garbage / empty / CLARIFY-without-Q / PLAN-without-steps', () => {
    expect(parsePlanDecision('not json').action).toBe('PROCEED');
    expect(parsePlanDecision('').action).toBe('PROCEED');
    expect(parsePlanDecision('{"action":"CLARIFY","questions":[]}').action).toBe('PROCEED');
    expect(parsePlanDecision('{"action":"PLAN","steps":[]}').action).toBe('PROCEED');
    expect(parsePlanDecision('{"action":"PLAN","title":"T"}').action).toBe('PROCEED');
  });

  it('downgrades CLARIFY to PROCEED when allowClarify is false (anti-loop)', () => {
    const out = parsePlanDecision('{"action":"CLARIFY","questions":["Опять?"]}', {
      allowClarify: false,
    });
    expect(out.action).toBe('PROCEED');
    expect(out.questions).toEqual([]);
  });

  it('still allows PLAN when allowClarify is false', () => {
    const out = parsePlanDecision('{"action":"PLAN","title":"T","steps":["s1"]}', {
      allowClarify: false,
    });
    expect(out.action).toBe('PLAN');
  });

  it('parses JSON embedded in prose / code fences', () => {
    const out = parsePlanDecision(
      'Вот план:\n```json\n{"action":"PLAN","title":"Тема","steps":["Шаг"]}\n```',
    );
    expect(out).toEqual({ action: 'PLAN', questions: [], title: 'Тема', steps: ['Шаг'] });
  });
});

describe('buildPlanPrompt', () => {
  it('asks for the CLARIFY|PLAN|PROCEED JSON and honors an explicit start', () => {
    const prompt = buildPlanPrompt({ now: '2026-07-09' });
    expect(prompt).toMatch(/CLARIFY\|PLAN\|PROCEED/);
    expect(prompt).toMatch(/"action"/);
    expect(prompt).toMatch(/"steps"/);
  });

  it('forbids CLARIFY when allowClarify is false', () => {
    const prompt = buildPlanPrompt({ now: '2026-07-09', allowClarify: false });
    expect(prompt).toMatch(/запрещено|БОЛЬШЕ НЕ УТОЧНЯЙ/);
  });
});

describe('formatPlanMessage + isPlanMessage', () => {
  it('renders marker + title + numbered steps and round-trips detection', () => {
    const msg = formatPlanMessage({ title: 'Рынок CRM', steps: ['Собрать', 'Сравнить'] });
    expect(msg.startsWith(`${PLAN_MARKER} Рынок CRM`)).toBe(true);
    expect(msg).toContain('1. Собрать');
    expect(msg).toContain('2. Сравнить');
    expect(isPlanMessage(msg)).toBe(true);
  });

  it('isPlanMessage is false for a normal report, cancel message, or empty text', () => {
    expect(isPlanMessage('## Ключевые выводы\n...')).toBe(false);
    expect(isPlanMessage(CANCELLED_MESSAGE)).toBe(false);
    expect(isPlanMessage('')).toBe(false);
  });
});

describe('isStartCommand / isCancelCommand', () => {
  it('match the exact command text, tolerating surrounding whitespace', () => {
    expect(isStartCommand(START_MARKER)).toBe(true);
    expect(isStartCommand(`  ${START_MARKER}  `)).toBe(true);
    expect(isCancelCommand(CANCEL_MARKER)).toBe(true);
  });

  it('are false for other text and for each other', () => {
    expect(isStartCommand('начать')).toBe(false);
    expect(isStartCommand(CANCEL_MARKER)).toBe(false);
    expect(isCancelCommand(START_MARKER)).toBe(false);
    expect(isCancelCommand('')).toBe(false);
  });
});
