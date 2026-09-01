import {
  PLAN_MARKER,
  START_MARKER,
  CANCEL_MARKER,
  MAX_PLAN_STEPS,
  isPlanMessage,
  buildPlanPrompt,
  isStartCommand,
  extractPlanSteps,
  extractPlanStepsFromTranscript,
  isCancelCommand,
  formatPlanMessage,
  CANCELLED_MESSAGE,
  parsePlanDecision,
} from './plan';

describe('marker literals (R6 pin)', () => {
  it('pins the exact wire strings shared with packages/data-provider deepResearch.ts', () => {
    // Duplicated in packages/data-provider/src/deepResearch.ts (this package cannot be
    // imported from there). A drift silently breaks card↔runner routing, so BOTH packages
    // pin the literals; change them together or the twin spec goes red.
    expect(PLAN_MARKER).toBe('**План исследования:**');
    expect(START_MARKER).toBe('Начать исследование');
    expect(CANCEL_MARKER).toBe('Отменить исследование');
    expect(CANCELLED_MESSAGE).toBe('Исследование отменено.');
  });
});

describe('parsePlanDecision (review r2: fails CLOSED to PLAN)', () => {
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

  it('a PROCEED on a turn with no approved plan is DOWNGRADED to PLAN (r28 review)', () => {
    /* The rule «a research always has a plan» cannot live in the prompt alone:
     * everything else in this parser is fail-closed precisely because a model
     * may answer off-contract. Without an approved plan in the branch there is
     * nothing to proceed WITH, so the gate must produce a card. */
    expect(parsePlanDecision('{"action":"PROCEED"}').action).toBe('PLAN');
    expect(parsePlanDecision('{"action":"PROCEED"}', { allowClarify: false }).action).toBe('PLAN');
  });

  it('honours PROCEED only where a plan already exists to be run', () => {
    expect(
      parsePlanDecision('{"action":"PROCEED"}', { allowClarify: false, allowProceed: true }).action,
    ).toBe('PROCEED');
  });

  it('fails CLOSED to PLAN on garbage / empty / CLARIFY-without-Q / PLAN-without-steps', () => {
    // The gate exists to demand explicit confirmation before the most expensive action —
    // ambiguous model output must present a card (the runner substitutes fallback steps
    // when the list is empty), never silently launch a run. Only an EXPLICIT PROCEED
    // proceeds (previous test).
    expect(parsePlanDecision('not json').action).toBe('PLAN');
    expect(parsePlanDecision('').action).toBe('PLAN');
    expect(parsePlanDecision('{"action":"CLARIFY","questions":[]}').action).toBe('PLAN');
    expect(parsePlanDecision('{"action":"PLAN","steps":[]}').action).toBe('PLAN');
    expect(parsePlanDecision('{"action":"PLAN","title":"T"}')).toEqual({
      action: 'PLAN',
      questions: [],
      title: 'T',
      steps: [],
    });
  });

  it('downgrades CLARIFY to PLAN when allowClarify is false (anti-loop)', () => {
    const out = parsePlanDecision('{"action":"CLARIFY","questions":["Опять?"]}', {
      allowClarify: false,
    });
    expect(out.action).toBe('PLAN');
    expect(out.questions).toEqual([]);
  });

  it('honors an explicit PROCEED when a plan already exists (the «начинай» reply)', () => {
    /* r28 review: `allowClarify: false` alone is not enough — answering
     * clarifying questions also lands here and leaves no plan in the branch. */
    expect(
      parsePlanDecision('{"action":"PROCEED"}', { allowClarify: false, allowProceed: true }).action,
    ).toBe('PROCEED');
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
  it('a FRESH turn may only clarify or plan — never decide a plan is unnecessary (r28)', () => {
    /* The owner's rule: «план всегда должен быть» — he approves it before the
     * run and reads the progress by it. A gate that could skip the plan left
     * the live card with no steps to show, which is what made it invent three
     * constants. PROCEED survives only as the anti-loop answer below. */
    const prompt = buildPlanPrompt({ now: '2026-07-09' });
    expect(prompt).toMatch(/"CLARIFY\|PLAN"/);
    expect(prompt).not.toMatch(/CLARIFY\|PLAN\|PROCEED/);
    expect(prompt).toMatch(/План нужен ВСЕГДА/);
    expect(prompt).toMatch(/"action"/);
    expect(prompt).toMatch(/"steps"/);
  });

  it('offers PROCEED only when an approved plan already exists (anti-loop)', () => {
    const withPlan = buildPlanPrompt({
      now: '2026-07-09',
      allowClarify: false,
      allowProceed: true,
    });
    expect(withPlan).toMatch(/"PLAN\|PROCEED"/);
    expect(withPlan).toMatch(/начинай/);
    /* Answering clarifying questions leaves no plan in the branch, so «начинай»
     * must still produce one rather than launch a planless run (r28 review). */
    const withoutPlan = buildPlanPrompt({ now: '2026-07-09', allowClarify: false });
    expect(withoutPlan).toMatch(/"PLAN"/);
    expect(withoutPlan).not.toMatch(/PROCEED/);
  });

  it('caps a step to one line of the card', () => {
    /* The steps are rows in a narrow card; the model was writing sentences that
     * wrapped to three lines (owner r28: «учти размер карточки»). */
    expect(buildPlanPrompt({ now: '2026-07-09' })).toMatch(/ДО 60 знаков/);
  });

  it('forbids CLARIFY when allowClarify is false', () => {
    const prompt = buildPlanPrompt({ now: '2026-07-09', allowClarify: false });
    expect(prompt).toMatch(/запрещено|БОЛЬШЕ НЕ УТОЧНЯЙ/);
  });

  it('adds a plan-edit refinement instruction when isRefinement is true (task #21)', () => {
    const prompt = buildPlanPrompt({ now: '2026-07-09', isRefinement: true });
    // The model is told to UPDATE the plan and reflect the user's change in the steps.
    expect(prompt).toMatch(/РЕЖИМ ПРАВКИ ПЛАНА/);
    expect(prompt).toMatch(/ОБНОВЛ/);
    expect(prompt).toMatch(/НЕ повторяй прежний план/);
  });

  it('omits the refinement instruction by default (a fresh plan turn)', () => {
    const prompt = buildPlanPrompt({ now: '2026-07-09' });
    expect(prompt).not.toMatch(/РЕЖИМ ПРАВКИ ПЛАНА/);
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

  it('extractPlanSteps round-trips the numbered list out of a formatted plan', () => {
    const steps = ['Собрать вендоров', 'Сравнить цены', 'Сформировать таблицу'];
    const msg = formatPlanMessage({ title: 'Рынок CRM', steps });
    expect(extractPlanSteps(msg)).toEqual(steps);
    expect(extractPlanSteps('нет шагов здесь')).toEqual([]);
    expect(extractPlanSteps('')).toEqual([]);
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
  });

  it('accepts the pre-18.08 pictograph markers from old conversations', () => {
    expect(isStartCommand('▶ Начать исследование')).toBe(true);
    expect(isCancelCommand('✕ Отменить исследование')).toBe(true);
    expect(isStartCommand('✕ Отменить исследование')).toBe(false);
    expect(isCancelCommand('▶ Начать исследование')).toBe(false);
    expect(isCancelCommand('')).toBe(false);
  });
});

describe('extractPlanStepsFromTranscript (r28)', () => {
  const plan = '**План исследования:** Рынок\n\n1. Собрать вендоров\n2. Сравнить цены';

  it('reads the steps out of a dialogue transcript', () => {
    const transcript = `Диалог по задаче исследования.\n\nИсходный запрос пользователя:\nизучи рынок\n\nПредложенный план:\n${plan}\n\nОтвет пользователя:\nНачать исследование`;
    expect(extractPlanStepsFromTranscript(transcript)).toEqual([
      'Собрать вендоров',
      'Сравнить цены',
    ]);
  });

  it('does NOT swallow the clarify questions, which are numbered the same way', () => {
    /* The whole reason for slicing from the marker: a naive scan of the
     * transcript would return the questions and the steps as one list, and the
     * count check downstream would then silently drop the agenda. */
    const transcript = `Уточняющие вопросы:\n1. Какой бюджет?\n2. Какой регион?\n\nОтвет пользователя:\nлюбой\n\nПредложенный план:\n${plan}`;
    expect(extractPlanStepsFromTranscript(transcript)).toEqual([
      'Собрать вендоров',
      'Сравнить цены',
    ]);
  });

  it('takes the LAST plan when the branch carries more than one', () => {
    const older = '**План исследования:** Старый\n\n1. Старый шаг';
    expect(extractPlanStepsFromTranscript(`${older}\n\nПредложенный план:\n${plan}`)).toEqual([
      'Собрать вендоров',
      'Сравнить цены',
    ]);
  });

  it('returns nothing when the transcript carries no plan at all', () => {
    expect(extractPlanStepsFromTranscript('Исходный запрос пользователя:\nизучи рынок')).toEqual(
      [],
    );
    expect(extractPlanStepsFromTranscript('')).toEqual([]);
  });

  it('survives masking — placeholders are ordinary text in a step', () => {
    const masked =
      '**План исследования:** Рынок\n\n1. Собрать данные по [PERSON_1]\n2. Сравнить цены';
    expect(extractPlanStepsFromTranscript(masked)).toEqual([
      'Собрать данные по [PERSON_1]',
      'Сравнить цены',
    ]);
  });
});

describe('a plan step is always one line (r28 review)', () => {
  it('folds a multi-line step so the two extractors cannot disagree', () => {
    /* `extractPlanStepsFromTranscript` stops at the first unnumbered line while
     * `extractPlanSteps` keeps scanning, so a step with a newline made the
     * counts differ and silently dropped the agenda in sovereign mode. */
    const decision = parsePlanDecision(
      JSON.stringify({
        action: 'PLAN',
        title: 'T',
        steps: ['Собрать данные\nи сравнить', 'Вывод'],
      }),
    );
    expect(decision.steps).toEqual(['Собрать данные и сравнить', 'Вывод']);
    const message = formatPlanMessage({ title: 'T', steps: decision.steps });
    expect(extractPlanSteps(message)).toEqual(extractPlanStepsFromTranscript(message));
  });
});
