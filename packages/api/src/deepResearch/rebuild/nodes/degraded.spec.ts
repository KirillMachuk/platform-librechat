import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import { logger } from '@librechat/data-schemas';
import { FakeListChatModel } from '@langchain/core/utils/testing';
import { AIMessage, AIMessageChunk, HumanMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { BaseMessage } from '@langchain/core/messages';
import type { DeepResearchState, DeepResearchFinding } from '../state';
import {
  researchOne,
  toolTimeoutMs,
  EMPTY_DIGEST,
  runResearchLoop,
  boundToolOutputs,
  hasResearchMaterial,
  type ToolCaller,
  type ResearcherNodeDeps,
} from './researcher';
import { composeReport, buildNoDataReport } from './report';
import { createSupervisorNode } from './supervisor';
import { resolveDeepResearchTier } from '../config';
import { createScopeNode } from './scope';

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const NOW = '2026-08-21T00:00:00Z';
const NONCE = 'test-nonce';
const TIER = resolveDeepResearchTier();

const warnings = (): string => (logger.warn as jest.Mock).mock.calls.flat().map(String).join('\n');

/** A model that answers `text` and reports how it stopped. */
const modelSaying = (text: string, finishReason = 'stop'): BaseChatModel =>
  ({
    invoke: async () =>
      new AIMessage({ content: text, response_metadata: { finish_reason: finishReason } }),
  }) as unknown as BaseChatModel;

function stateWith(partial: Partial<DeepResearchState>): DeepResearchState {
  return {
    messages: [],
    jurisdiction: 'RU',
    researchBrief: '',
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

beforeEach(() => jest.clearAllMocks());

describe('a tool failure is not research material', () => {
  const throwingTool = tool(
    async () => {
      throw new Error('boom');
    },
    { name: 'web_search', description: 'поиск', schema: z.object({ query: z.string() }) },
  );

  const callerAskingOnce = (): ToolCaller => {
    const responses = [
      new AIMessageChunk({
        content: '',
        tool_calls: [{ name: 'web_search', args: { query: 'q' }, id: 'c1', type: 'tool_call' }],
      }),
      new AIMessageChunk({ content: 'готово' }),
    ];
    let i = 0;
    return { invoke: async () => responses[Math.min(i++, responses.length - 1)] };
  };

  it('a run whose every search failed yields NO material, not a compressed error string', async () => {
    const deps: ResearcherNodeDeps = {
      model: {} as BaseChatModel,
      // If the error text reached COMPRESS, this is the digest the user's report would be
      // built from — a confident sentence with no source behind it.
      compressModel: new FakeListChatModel({
        responses: ['Ставка снижена до 12%.'],
      }) as unknown as BaseChatModel,
      tools: [throwingTool],
      tier: TIER,
      now: NOW,
      nonce: NONCE,
    };
    const { finding } = await researchOne({
      caller: callerAskingOnce(),
      deps,
      subQuestion: 'какая ставка',
      round: 0,
      jurisdiction: 'RU',
      tokenCap: Number.POSITIVE_INFINITY,
    });
    expect(finding.digest).toBe(EMPTY_DIGEST);
    // REPORT asks exactly this before deciding to write an analysis at all.
    expect(hasResearchMaterial(finding)).toBe(false);
    expect(warnings()).toContain('returned no data');
  });
});

describe('boundToolOutputs', () => {
  it('empty outputs do not become a truthy separator string', () => {
    // Joining ['', ''] produced '\n\n---\n\n', which is truthy, so COMPRESS was invoked —
    // and billed — on nothing but separators.
    expect(boundToolOutputs(['', '   '])).toBe('');
  });

  it('keeps real outputs joined as before', () => {
    expect(boundToolOutputs(['a', '', 'b'])).toBe('a\n\n---\n\nb');
  });
});

describe('toolTimeoutMs — a started turn cannot run 300 s past the gather deadline', () => {
  it('uses the full timeout when there is no deadline', () => {
    expect(toolTimeoutMs(undefined)).toBe(60_000);
    expect(toolTimeoutMs(Number.POSITIVE_INFINITY)).toBe(60_000);
  });

  it('never exceeds the full timeout even with a distant deadline', () => {
    expect(toolTimeoutMs(600_000)).toBe(60_000);
  });

  it('shortens to the time actually left', () => {
    expect(toolTimeoutMs(30_000)).toBe(30_000);
  });

  it('keeps a floor so a call starting marginally late can still send', () => {
    expect(toolTimeoutMs(0)).toBe(5_000);
    expect(toolTimeoutMs(-10_000)).toBe(5_000);
  });
});

describe('the deadline budget actually reaches the tool call', () => {
  /**
   * The arithmetic above is only worth anything if the loop passes the budget IN. It did not
   * have to: reverting just the wiring — passing `undefined` where the remaining time goes —
   * left every other test in this repo green, which is precisely how a fix rots.
   *
   * So this one measures the effect. The clock reads BEFORE the deadline once (the turn gate
   * lets the turn start) and far past it afterwards (the tool call gets a zero budget, and
   * therefore the floor). A hanging tool must then come back in about the floor. Without the
   * wiring it waits the full TOOL_TIMEOUT_MS of 60 s and this test times out instead.
   */
  it('a call starting past the deadline is cut at the floor, not at 60 s', async () => {
    const hangingTool = tool(
      async (_input: { query: string }, config?: { signal?: AbortSignal }) =>
        new Promise<string>((_resolve, reject) => {
          config?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        }),
      { name: 'web_search', description: 'поиск', schema: z.object({ query: z.string() }) },
    );
    let reads = 0;
    // First read: the turn gate, before the deadline. Every later read: long past it.
    const clock = () => (reads++ === 0 ? 0 : 1_000_000);
    const responses = [
      new AIMessageChunk({
        content: '',
        tool_calls: [{ name: 'web_search', args: { query: 'q' }, id: 'c1', type: 'tool_call' }],
      }),
      new AIMessageChunk({ content: 'готово' }),
    ];
    let i = 0;
    const caller: ToolCaller = {
      invoke: async () => responses[Math.min(i++, responses.length - 1)],
    };

    const startedAt = Date.now();
    const result = await runResearchLoop({
      caller,
      tools: [hangingTool],
      system: 's',
      question: 'q',
      maxTurns: 1,
      tokenCap: Number.POSITIVE_INFINITY,
      nonce: NONCE,
      deadlineMs: 500_000,
      clock,
    });

    expect(Date.now() - startedAt).toBeLessThan(20_000);
    // The cut call yielded nothing, and nothing is what it contributes.
    expect(result.toolOutputs).toEqual([]);
  }, 30_000);
});

describe('SCOPE — a cut answer is a JSON fragment, not a brief', () => {
  const request = 'Сравни CRM для среднего бизнеса';

  it('falls back to the user request when the answer was cut mid-JSON', async () => {
    const node = createScopeNode({
      model: modelSaying('{"jurisdiction":"RU","brief":"Рынок CRM в Рос', 'length'),
      now: NOW,
    });
    const update = await node(stateWith({ messages: [new HumanMessage(request)] }));
    expect(update.researchBrief).toBe(request);
  });

  it('still accepts prose that simply is not JSON', async () => {
    const node = createScopeNode({ model: modelSaying('Изучить рынок CRM.'), now: NOW });
    const update = await node(stateWith({ messages: [new HumanMessage(request)] }));
    expect(update.researchBrief).toBe('Изучить рынок CRM.');
  });
});

describe('SUPERVISOR — an answer that is not JSON collapses the fan-out, and says so', () => {
  it('warns when a full answer yields neither a batch nor a complete', async () => {
    const node = createSupervisorNode({
      model: modelSaying('Извините, я не могу выполнить эту задачу.'),
      tier: TIER,
      now: NOW,
      nonce: NONCE,
      clock: () => 0,
    });
    const update = await node(
      stateWith({ researchBrief: 'бриф', messages: [new HumanMessage('в')] }),
      {} as RunnableConfig,
    );
    // The fallback itself is deliberate — losing it in silence was not.
    expect(update.currentSubQuestions).toEqual(['бриф']);
    expect(warnings()).toContain('unparseable answer');
  });

  it('says nothing when the model legitimately concludes after a round', async () => {
    const node = createSupervisorNode({
      model: modelSaying('{"action":"complete"}'),
      tier: TIER,
      now: NOW,
      nonce: NONCE,
      clock: () => 0,
    });
    const update = await node(
      stateWith({ researchBrief: 'бриф', round: 1, findings: [] }),
      {} as RunnableConfig,
    );
    expect(update.concludeReason).toBe('complete');
    expect(warnings()).not.toContain('unparseable answer');
  });

  it('says nothing when the answer parses', async () => {
    const node = createSupervisorNode({
      model: modelSaying('{"action":"research","subQuestions":["а","б"]}'),
      tier: TIER,
      now: NOW,
      nonce: NONCE,
      clock: () => 0,
    });
    const update = await node(stateWith({ researchBrief: 'бриф' }), {} as RunnableConfig);
    expect(update.currentSubQuestions).toEqual(['а', 'б']);
    expect(warnings()).not.toContain('unparseable answer');
  });
});

describe('REPORT — a retry shrinks the evidence and the citations together', () => {
  it('halves the source list alongside the digest', async () => {
    const sources = Array.from({ length: 50 }, (_, i) => `https://example.com/doc-${i}`);
    const findings: DeepResearchFinding[] = [
      { round: 0, subQuestion: 'в', digest: 'ц'.repeat(2000), sources, tokens: 10 },
    ];
    const prompts: BaseMessage[][] = [];
    let call = 0;
    const reportModel = {
      invoke: async (messages: BaseMessage[]) => {
        prompts.push([...messages]);
        if (call++ === 0) {
          throw new Error('maximum context length exceeded');
        }
        return new AIMessage({ content: '# Отчёт', response_metadata: { finish_reason: 'stop' } });
      },
    };
    await composeReport({
      reportModel,
      request: 'з',
      brief: 'б',
      jurisdiction: 'RU',
      findings,
      digestCap: 2000,
      now: NOW,
      nonce: NONCE,
    });
    const urls = (messages: BaseMessage[]): number =>
      (String(messages[1].content).match(/https:\/\//g) ?? []).length;
    expect(urls(prompts[0])).toBe(50);
    // Before: the digest was cut to half while all 50 URLs stayed — the model saw the
    // citations of facts whose text had been taken away, and wrote the report anyway.
    expect(urls(prompts[1])).toBe(25);
  });
});

describe('the no-data notice states what it knows and no more', () => {
  /**
   * It used to assert a cause outright: "источники не открылись или поиск был недоступен".
   * That was wrong for a run that had merely exhausted its allowance — and simply inverting
   * it would be just as wrong, because a dead search PRESENTS as an exhausted allowance:
   * the rounds still run and still burn the clock. The stop reason is a fact the run knows;
   * the cause of the emptiness is not.
   */
  it('names the stop reason as the fact it is', () => {
    expect(buildNoDataReport({ request: 'з', findings: [], reason: 'budget' })).toContain(
      'бюджет токенов',
    );
    expect(buildNoDataReport({ request: 'з', findings: [], reason: 'time' })).toContain('время');
    expect(buildNoDataReport({ request: 'з', findings: [], reason: 'rounds' })).toContain('кругов');
    expect(buildNoDataReport({ request: 'з', findings: [], reason: 'complete' })).toContain(
      'не вернул пригодных источников',
    );
  });

  it('never claims the search was unavailable for a run that ran out of its allowance', () => {
    const text = buildNoDataReport({ request: 'з', findings: [], reason: 'budget' });
    expect(text).not.toContain('поиск был недоступен');
    expect(text).not.toContain('источники не открылись');
  });

  /**
   * Ordering advice by a fact the run knows is not the same as asserting a cause. An earlier
   * revision offered "narrow the query, it will fit the limit" for EVERY outcome — including
   * one where no limit was reached, which made the notice contradict its own opening line and
   * pointed a user whose search had broken off at a second twenty-minute run that could not
   * have helped.
   */
  it('tells a run that ran out of its allowance to narrow the query', () => {
    for (const reason of ['budget', 'time', 'rounds'] as const) {
      const text = buildNoDataReport({ request: 'з', findings: [], reason });
      expect(text).toContain('сузьте запрос');
      expect(text).toContain('администратору');
    }
  });

  it('tells a run that hit NO limit to retry, never to narrow for a limit it never hit', () => {
    const text = buildNoDataReport({ request: 'з', findings: [], reason: 'complete' });
    expect(text).toContain('повторите исследование');
    expect(text).toContain('администратору');
    expect(text).not.toContain('уложиться в лимит');
    expect(text).not.toContain('сузьте запрос');
  });

  it('names nothing rather than inventing a phrase when no reason was recorded', () => {
    const text = buildNoDataReport({ request: 'з', findings: [] });
    // No tautological "material was not gathered: gathering stopped".
    expect(text).toContain('не собрано пригодного материала.');
    expect(text).toContain('повторите исследование');
  });
});
