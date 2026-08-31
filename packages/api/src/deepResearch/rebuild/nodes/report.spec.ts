import { FakeListChatModel } from '@langchain/core/utils/testing';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { BaseMessage } from '@langchain/core/messages';
import type { DeepResearchState, DeepResearchFinding } from '../state';
import {
  composeReport,
  createReportNode,
  buildFallbackReport,
  concludeToFinalize,
  type ReportModel,
} from './report';
import { resolveDeepResearchTier } from '../config';

const NOW = '2026-06-25T00:00:00Z';
const NONCE = 'test-nonce';
const TIER = resolveDeepResearchTier();

const finding = (subQuestion: string): DeepResearchFinding => ({
  round: 1,
  subQuestion,
  digest: `дайджест по «${subQuestion}»`,
  sources: ['https://cbr.ru/x'],
  tokens: 100,
});

function stateWith(partial: Partial<DeepResearchState>): DeepResearchState {
  return {
    messages: [new HumanMessage('изучи рынок')],
    jurisdiction: 'RU',
    researchBrief: 'бриф',
    currentSubQuestion: '',
    currentSubQuestions: [],
    findings: [],
    round: 0,
    planStep: 0,
    researcherCount: 0,
    tokenUsage: { input: 0, output: 0, total: 0 },
    usageByModel: {},
    errors: [],
    finalReport: '',
    finalizeReason: null,
    concludeReason: null,
    ...partial,
  };
}

describe('concludeToFinalize', () => {
  it('maps budget/rounds to their own partial reasons and complete → completed', () => {
    expect(concludeToFinalize('budget')).toBe('budget');
    expect(concludeToFinalize('rounds')).toBe('rounds');
    expect(concludeToFinalize('complete')).toBe('completed');
    expect(concludeToFinalize(null)).toBe('completed');
  });

  it('maps the soft TIME gate to completed — a model-written report in time, NOT a partial (A1)', () => {
    // The time gate reserves the tail of the wall-clock for synthesis, so the model
    // writes a full report; only the HARD watchdog (run wrapper) yields a 'time' partial.
    expect(concludeToFinalize('time')).toBe('completed');
  });

  it('maps a supervisor ERROR to an error partial — never a silent "completed"', () => {
    expect(concludeToFinalize('error')).toBe('error');
  });
});

describe('buildFallbackReport', () => {
  it('is an honest short notice — no raw findings dump, no brief echo (owner: no partial reports)', () => {
    const report = buildFallbackReport({ reason: 'пустой ответ модели' });
    expect(report).toContain('Не удалось сформировать отчёт');
    expect(report).toContain('пустой ответ модели');
    // The dump the owner disliked must be gone: no findings, no "Собранные материалы",
    // no "Запрос:" echo of the (plan-bearing) dialogue.
    expect(report).not.toContain('Собранные материалы');
    expect(report).not.toContain('Запрос:');
    expect(report).toContain('сузьте запрос');
  });
});

describe('composeReport', () => {
  const base = {
    request: 'q',
    brief: 'b',
    jurisdiction: 'RU',
    findings: [finding('Q1')],
    digestCap: 2000,
    now: NOW,
    nonce: NONCE,
  };

  it('returns the model report on success', async () => {
    const result = await composeReport({
      ...base,
      reportModel: new FakeListChatModel({
        responses: ['# Записка\nКлючевые выводы: рынок растёт.'],
      }),
    });
    expect(result.text).toContain('Ключевые выводы');
    expect(result.fellBack).toBe(false);
  });

  it('retries on a context-limit error, then succeeds', async () => {
    let calls = 0;
    const flaky: ReportModel = {
      invoke: async () => {
        calls += 1;
        if (calls === 1) {
          throw new Error('maximum context length exceeded');
        }
        return new AIMessage('# Записка после ретрая');
      },
    };
    const result = await composeReport({ ...base, reportModel: flaky });
    expect(result.text).toContain('после ретрая');
    expect(calls).toBe(2);
  });

  it('falls back to a deterministic report on a non-context error (no retry)', async () => {
    let calls = 0;
    const broken: ReportModel = {
      invoke: async () => {
        calls += 1;
        throw new Error('500 internal server error');
      },
    };
    const result = await composeReport({ ...base, reportModel: broken, maxRetries: 3 });
    expect(result.fellBack).toBe(true);
    expect(result.text).toContain('Не удалось сформировать отчёт');
    expect(result.text).not.toContain('Q1'); // no findings dump
    expect(calls).toBe(1);
  });

  it('falls back after exhausting context-limit retries', async () => {
    const alwaysBig: ReportModel = {
      invoke: async () => {
        throw new Error('context_length_exceeded');
      },
    };
    const result = await composeReport({ ...base, reportModel: alwaysBig, maxRetries: 2 });
    expect(result.fellBack).toBe(true);
    expect(result.text).toContain('Не удалось сформировать отчёт');
  });

  it('RETRIES an empty answer with a smaller digest cap, then succeeds', async () => {
    /**
     * An empty answer used to skip the retry loop entirely — the one failure the
     * machinery above was built for and then not used on. Measured on the stand: a run
     * that had gathered 7 findings and spent 355k tokens returned an empty report, and
     * the whole research was thrown away on a single silent non-answer.
     *
     * The prompt must also SHRINK between attempts: retrying with the identical prompt
     * would just ask the same question again, and an oversized prompt is the likeliest
     * reason a model returns nothing without raising a context error.
     */
    const promptSizes: number[] = [];
    let calls = 0;
    const emptyThenGood: ReportModel = {
      invoke: async (messages: BaseMessage[]) => {
        calls += 1;
        promptSizes.push(String(messages[1]?.content ?? '').length);
        return calls === 1 ? new AIMessage('   ') : new AIMessage('# Записка со второй попытки');
      },
    };
    // The digest must be LONGER than the cap, or halving the cap changes nothing and the
    // assertion below would pass on a fixture that never exercised the setting.
    const long = (q: string): DeepResearchFinding => ({ ...finding(q), digest: 'д'.repeat(3000) });
    const result = await composeReport({
      ...base,
      digestCap: 2000,
      findings: [long('Q1'), long('Q2')],
      reportModel: emptyThenGood,
    });
    expect(calls).toBe(2);
    expect(result.fellBack).toBe(false);
    expect(result.text).toContain('со второй попытки');
    expect(promptSizes[1]).toBeLessThan(promptSizes[0]);
  });

  it('RETRIES a CUT answer instead of shipping it as a finished report', async () => {
    /**
     * The defect this pins, seen by the owner on 2026-08-20: the report model stopped at
     * the output ceiling, the node asked only "is there text?", and 1013 characters
     * ending mid-word were saved and shown as a completed report — no error, no marker.
     */
    let calls = 0;
    const cutThenGood: ReportModel = {
      invoke: async () => {
        calls += 1;
        if (calls === 1) {
          return new AIMessage({
            content: 'оптимальным по соотношению «цена — соответствие» выгля',
            response_metadata: { finish_reason: 'length' },
          });
        }
        return new AIMessage({
          content: '# Полный отчёт',
          response_metadata: { finish_reason: 'stop' },
        });
      },
    };
    const result = await composeReport({ ...base, reportModel: cutThenGood });
    expect(calls).toBe(2);
    expect(result.fellBack).toBe(false);
    expect(result.text).toBe('# Полный отчёт');
  });

  /**
   * A discarded attempt is a BILLED call. When a later attempt succeeds, its tokens used to
   * vanish from the run's aggregate while still appearing in the per-model split — and a
   * split that exceeds the aggregate is discarded by billing, which then prices the whole
   * run at the lead model's rate. So the same omission both lost tokens and quietly undid
   * the split. REPORT carries the largest prompt of the run (every finding), so the loss is
   * the biggest one available.
   */
  it('counts a discarded attempt in BOTH the aggregate and the split when a retry succeeds', async () => {
    let calls = 0;
    const emptyThenGood: ReportModel = {
      invoke: async () => {
        calls += 1;
        return calls === 1
          ? new AIMessage({
              content: '',
              response_metadata: { model_name: 'report/model' },
              usage_metadata: { input_tokens: 500, output_tokens: 0, total_tokens: 500 },
            })
          : new AIMessage({
              content: '# Полный отчёт',
              response_metadata: { model_name: 'report/model' },
              usage_metadata: { input_tokens: 300, output_tokens: 200, total_tokens: 500 },
            });
      },
    };

    const result = await composeReport({ ...base, reportModel: emptyThenGood });

    expect(calls).toBe(2);
    expect(result.fellBack).toBe(false);
    expect(result.usage).toEqual({ input: 800, output: 200, total: 1000 });
    // The split must agree with the aggregate, or billing throws it away.
    const split = Object.values(result.usageByModel).reduce(
      (acc, u) => ({ input: acc.input + u.input, output: acc.output + u.output }),
      { input: 0, output: 0 },
    );
    expect(split).toEqual({ input: result.usage.input, output: result.usage.output });
  });

  it('falls back with the CUT reason when every attempt is truncated', async () => {
    const alwaysCut: ReportModel = {
      invoke: async () =>
        new AIMessage({ content: 'обрыв', response_metadata: { finish_reason: 'length' } }),
    };
    const result = await composeReport({ ...base, reportModel: alwaysCut, maxRetries: 1 });
    expect(result.fellBack).toBe(true);
    expect(result.text).toContain('оборван');
    // The half-written text must NOT reach the user dressed as a report.
    expect(result.text).not.toContain('обрыв');
  });

  it('falls back only after EVERY attempt came back empty, and still counts what they burnt', async () => {
    let calls = 0;
    const alwaysEmpty: ReportModel = {
      invoke: async () => {
        calls += 1;
        const msg = new AIMessage('');
        // Each discarded attempt was billed; usage must not vanish with the answer.
        msg.usage_metadata = { input_tokens: 100, output_tokens: 0, total_tokens: 100 };
        return msg;
      },
    };
    const result = await composeReport({ ...base, reportModel: alwaysEmpty, maxRetries: 2 });
    expect(calls).toBe(3); // attempt 0, 1, 2
    expect(result.fellBack).toBe(true);
    expect(result.text).toContain('пустой ответ модели');
    expect(result.usage?.input).toBe(300);
  });

  it('re-throws on a real abort', async () => {
    const controller = new AbortController();
    controller.abort();
    const aborted: ReportModel = {
      invoke: async () => {
        throw new Error('Aborted');
      },
    };
    await expect(
      composeReport({ ...base, reportModel: aborted, findings: [], signal: controller.signal }),
    ).rejects.toThrow();
  });
});

describe('createReportNode', () => {
  const emptyConfig: RunnableConfig = {};

  it('always produces a finalReport and maps finalizeReason', async () => {
    const node = createReportNode({
      reportModel: new FakeListChatModel({ responses: ['# Итоговая записка'] }),
      tier: TIER,
      now: NOW,
      nonce: NONCE,
    });
    const update = await node(
      stateWith({ findings: [finding('Q1')], concludeReason: 'budget' }),
      emptyConfig,
    );
    expect(update.finalReport).toContain('Итоговая записка');
    expect(update.finalizeReason).toBe('budget');
  });

  it('maps a supervisor ERROR conclude to an error partial (banner), still writing from findings', async () => {
    const node = createReportNode({
      reportModel: new FakeListChatModel({ responses: ['# Что успели собрать'] }),
      tier: TIER,
      now: NOW,
      nonce: NONCE,
    });
    const update = await node(
      stateWith({ findings: [finding('Q1')], concludeReason: 'error' }),
      emptyConfig,
    );
    expect(update.finalReport).toContain('Что успели собрать');
    expect(update.finalizeReason).toBe('error');
  });

  it('refuses to fake a report out of ZERO usable material — honest nodata, model NOT called', async () => {
    const model = new FakeListChatModel({ responses: ['# Псевдо-отчёт'] });
    const spy = jest.spyOn(model, 'invoke');
    const node = createReportNode({ reportModel: model, tier: TIER, now: NOW, nonce: NONCE });
    const placeholderFinding: DeepResearchFinding = {
      round: 1,
      subQuestion: 'Q1',
      digest: '(по этому под-вопросу не удалось собрать данные)',
      sources: [],
      tokens: 10,
    };
    const update = await node(
      stateWith({ findings: [placeholderFinding], concludeReason: 'complete' }),
      emptyConfig,
    );
    expect(spy).not.toHaveBeenCalled();
    expect(update.finalizeReason).toBe('nodata');
    expect(update.finalReport).toContain('Не удалось собрать материал');
    expect(update.finalReport).toContain('Q1');
  });

  it('supervisor error + zero material → deterministic error fallback (not nodata)', async () => {
    const model = new FakeListChatModel({ responses: ['# Псевдо-отчёт'] });
    const spy = jest.spyOn(model, 'invoke');
    const node = createReportNode({ reportModel: model, tier: TIER, now: NOW, nonce: NONCE });
    const update = await node(stateWith({ findings: [], concludeReason: 'error' }), emptyConfig);
    expect(spy).not.toHaveBeenCalled();
    expect(update.finalizeReason).toBe('error');
    expect(update.finalReport).toContain('Не удалось сформировать отчёт');
  });

  it('a failed synthesis (model fell back) becomes an error outcome, not a mislabeled report', async () => {
    // With material present but the model unavailable, the node must NOT save the fallback
    // notice as a (budget) report — it flips finalizeReason to 'error' so no PDF/report chip.
    const broken = new FakeListChatModel({ responses: [''] });
    jest.spyOn(broken, 'invoke').mockRejectedValue(new Error('500 internal error'));
    const node = createReportNode({ reportModel: broken, tier: TIER, now: NOW, nonce: NONCE });
    const update = await node(
      stateWith({ findings: [finding('Q1')], concludeReason: 'budget' }),
      emptyConfig,
    );
    expect(update.finalizeReason).toBe('error');
    expect(update.finalReport).toContain('Не удалось сформировать отчёт');
  });
});
