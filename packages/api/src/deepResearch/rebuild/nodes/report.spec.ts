import { FakeListChatModel } from '@langchain/core/utils/testing';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
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
    researcherCount: 0,
    tokenUsage: { input: 0, output: 0, total: 0 },
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
});

describe('buildFallbackReport', () => {
  it('assembles a report from findings without a model', () => {
    const report = buildFallbackReport({
      brief: 'b',
      jurisdiction: 'RU',
      findings: [finding('Q1')],
      reason: 'тест',
    });
    expect(report).toContain('частичный отчёт');
    expect(report).toContain('Q1');
    expect(report).toContain('cbr.ru');
  });

  it('handles empty findings', () => {
    const report = buildFallbackReport({
      brief: 'b',
      jurisdiction: 'RU',
      findings: [],
      reason: 'тест',
    });
    expect(report).toContain('не удалось собрать данные');
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
    expect(result.text).toContain('частичный отчёт');
    expect(result.text).toContain('Q1');
    expect(calls).toBe(1);
  });

  it('falls back after exhausting context-limit retries', async () => {
    const alwaysBig: ReportModel = {
      invoke: async () => {
        throw new Error('context_length_exceeded');
      },
    };
    const result = await composeReport({ ...base, reportModel: alwaysBig, maxRetries: 2 });
    expect(result.text).toContain('частичный отчёт');
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
});
