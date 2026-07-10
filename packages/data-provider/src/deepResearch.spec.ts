import {
  DR_PLAN_MARKER,
  DR_START_MARKER,
  DR_CANCEL_MARKER,
  DR_CLARIFY_MARKER,
  isDrPlanMessage,
  isDrStartCommand,
  isDrCancelCommand,
  isDrAssistantTurn,
  extractDrPlanSteps,
  parseDrPlanMessage,
} from './deepResearch';

describe('deepResearch shared plan-gate primitives', () => {
  it('pins the exact marker literals — the wire protocol with packages/api plan.ts (R6)', () => {
    // These strings are duplicated in packages/api (plan.ts markers, clarify.ts
    // CLARIFY_MARKER) — the backend cannot import from data-provider's ESM build. A drift
    // breaks routing between the card and the runner, so both packages pin the literals;
    // change them TOGETHER.
    expect(DR_PLAN_MARKER).toBe('**План исследования:**');
    expect(DR_START_MARKER).toBe('▶ Начать исследование');
    expect(DR_CANCEL_MARKER).toBe('✕ Отменить исследование');
    expect(DR_CLARIFY_MARKER).toBe('**Уточните, пожалуйста, детали исследования:**');
  });

  it('isDrAssistantTurn matches a plan OR a clarify message (for report ancestry)', () => {
    expect(isDrAssistantTurn(`${DR_PLAN_MARKER} Тема\n1. Шаг`)).toBe(true);
    expect(isDrAssistantTurn(`  ${DR_CLARIFY_MARKER}\n1. Масштаб?`)).toBe(true);
    expect(isDrAssistantTurn('## Отчёт\nтекст')).toBe(false);
    expect(isDrAssistantTurn('')).toBe(false);
  });

  it('detects a plan message only when the marker is the first line', () => {
    expect(isDrPlanMessage(`${DR_PLAN_MARKER} Рынок CRM\n\n1. Шаг`)).toBe(true);
    expect(isDrPlanMessage(`  ${DR_PLAN_MARKER} X`)).toBe(true);
    expect(isDrPlanMessage('## Отчёт\n...')).toBe(false);
    expect(isDrPlanMessage('Исследование отменено.')).toBe(false);
    expect(isDrPlanMessage('')).toBe(false);
  });

  it('matches the exact start/cancel commands (trim-tolerant)', () => {
    expect(isDrStartCommand(DR_START_MARKER)).toBe(true);
    expect(isDrStartCommand(`  ${DR_START_MARKER} `)).toBe(true);
    expect(isDrStartCommand('начать')).toBe(false);
    expect(isDrCancelCommand(DR_CANCEL_MARKER)).toBe(true);
    expect(isDrCancelCommand(DR_START_MARKER)).toBe(false);
  });

  it('extracts the numbered step list, ignoring non-list lines', () => {
    const msg = `${DR_PLAN_MARKER} Тема\n\n1. Собрать вендоров\n2. Сравнить цены\n3. Сформировать таблицу`;
    expect(extractDrPlanSteps(msg)).toEqual([
      'Собрать вендоров',
      'Сравнить цены',
      'Сформировать таблицу',
    ]);
    expect(extractDrPlanSteps('нет списка')).toEqual([]);
    expect(extractDrPlanSteps('')).toEqual([]);
  });

  it('parses a plan message into its title + steps', () => {
    const msg = `${DR_PLAN_MARKER} Рынок CRM в СНГ\n\n1. Собрать\n2. Сравнить`;
    expect(parseDrPlanMessage(msg)).toEqual({
      title: 'Рынок CRM в СНГ',
      steps: ['Собрать', 'Сравнить'],
    });
  });

  it('parseDrPlanMessage returns an empty title when the marker is absent', () => {
    expect(parseDrPlanMessage('обычный текст\n1. шаг')).toEqual({ title: '', steps: ['шаг'] });
    expect(parseDrPlanMessage('')).toEqual({ title: '', steps: [] });
  });
});
