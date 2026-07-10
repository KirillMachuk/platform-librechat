import type { TMessage } from 'librechat-data-provider';
import { resolveDrReport, extractReportTitle } from '../report';

// Mirror the real data-provider helpers (unit-tested in deepResearch.spec.ts). Mocked here
// only because jest can't resolve the bare package's bundled exports; this suite verifies
// resolveDrReport's ancestor-walk logic, not the marker literals.
const PLAN_MARKER = '**План исследования:**';
const CLARIFY_MARKER = '**Уточните, пожалуйста, детали исследования:**';
const START_MARKER = '▶ Начать исследование';
jest.mock('librechat-data-provider', () => ({
  isDrPlanMessage: (t: string) => typeof t === 'string' && t.trimStart().startsWith(PLAN_MARKER),
  isDrStartCommand: (t: string) => typeof t === 'string' && t.trim() === START_MARKER,
  isDrAssistantTurn: (t: string) =>
    typeof t === 'string' &&
    (t.trimStart().startsWith(PLAN_MARKER) || t.trimStart().startsWith(CLARIFY_MARKER)),
}));

const PLAN = '**План исследования:** Рынок CRM\n\n1. Собрать\n2. Сравнить';
const CLARIFY = '**Уточните, пожалуйста, детали исследования:**\n1. Масштаб?';
const START = '▶ Начать исследование';
const REPORT = '# Рынок CRM в СНГ\n\nНа рынке СНГ...\n\n## Игроки\n...';

const msg = (over: Partial<TMessage>): TMessage =>
  ({ isCreatedByUser: false, text: '', ...over }) as unknown as TMessage;

describe('extractReportTitle', () => {
  it('takes the first H1/H2 and strips markdown', () => {
    expect(extractReportTitle('# **Рынок** CRM\n\nтекст')).toBe('Рынок CRM');
    expect(extractReportTitle('## Итоги\nтекст')).toBe('Итоги');
  });
  it('returns null when there is no heading', () => {
    expect(extractReportTitle('просто текст без заголовка')).toBeNull();
    expect(extractReportTitle('')).toBeNull();
  });
});

describe('resolveDrReport', () => {
  it('detects a report after plan → START (parent is the start command)', () => {
    const messages = [
      msg({ messageId: 'p1', text: PLAN }),
      msg({ messageId: 'u2', parentMessageId: 'p1', isCreatedByUser: true, text: START }),
      msg({ messageId: 'r3', parentMessageId: 'u2', text: REPORT }),
    ];
    expect(resolveDrReport(messages[2], messages)).toEqual({ title: 'Рынок CRM в СНГ' });
  });

  it('detects a report after plan → user edit (grandparent is the plan)', () => {
    const messages = [
      msg({ messageId: 'p1', text: PLAN }),
      msg({
        messageId: 'u2',
        parentMessageId: 'p1',
        isCreatedByUser: true,
        text: 'уточни: только РФ',
      }),
      msg({ messageId: 'r3', parentMessageId: 'u2', text: REPORT }),
    ];
    expect(resolveDrReport(messages[2], messages)).toEqual({ title: 'Рынок CRM в СНГ' });
  });

  it('detects a report after clarify → answer (grandparent is the clarify message)', () => {
    const messages = [
      msg({ messageId: 'c1', text: CLARIFY }),
      msg({ messageId: 'u2', parentMessageId: 'c1', isCreatedByUser: true, text: 'весь СНГ' }),
      msg({ messageId: 'r3', parentMessageId: 'u2', text: REPORT }),
    ];
    expect(resolveDrReport(messages[2], messages)).toEqual({ title: 'Рынок CRM в СНГ' });
  });

  it('does NOT treat a normal assistant message as a report (no DR ancestor)', () => {
    const messages = [
      msg({ messageId: 'u1', isCreatedByUser: true, text: 'привет' }),
      msg({ messageId: 'a2', parentMessageId: 'u1', text: REPORT }),
    ];
    expect(resolveDrReport(messages[1], messages)).toBeNull();
  });

  it('returns null for the plan card itself, user messages, and empty text', () => {
    const plan = msg({ messageId: 'p1', text: PLAN, parentMessageId: 'u0' });
    const user = msg({ messageId: 'u1', isCreatedByUser: true, text: REPORT });
    expect(resolveDrReport(plan, [plan])).toBeNull();
    expect(resolveDrReport(user, [user])).toBeNull();
  });

  it('returns null when the report has no heading (failure/aborted text)', () => {
    const messages = [
      msg({ messageId: 'p1', text: PLAN }),
      msg({ messageId: 'u2', parentMessageId: 'p1', isCreatedByUser: true, text: START }),
      msg({ messageId: 'r3', parentMessageId: 'u2', text: 'Исследование прервано.' }),
    ];
    expect(resolveDrReport(messages[2], messages)).toBeNull();
  });

  it('returns null with no message cache (share page)', () => {
    expect(
      resolveDrReport(msg({ messageId: 'r3', parentMessageId: 'u2', text: REPORT }), undefined),
    ).toBeNull();
    expect(
      resolveDrReport(msg({ messageId: 'r3', parentMessageId: 'u2', text: REPORT }), []),
    ).toBeNull();
  });
});
