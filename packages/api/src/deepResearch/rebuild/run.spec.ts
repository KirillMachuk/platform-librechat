import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { FakeListChatModel, FakeStreamingChatModel } from '@langchain/core/utils/testing';

import type { DeepResearchConfigurable } from './state';
import type { DeepResearchProgress } from './run';
import { resolveDeepResearchTier, tierToRunBudget } from './config';
import { createDeepResearchGraph } from './graph';
import { runDeepResearch } from './run';

const NOW = '2026-06-25T00:00:00Z';
const NONCE = 'test-nonce';
const TIER = resolveDeepResearchTier();

function configurable(): DeepResearchConfigurable {
  return { runId: 'run-1', userId: 'user-1', mode: 'deep', budget: tierToRunBudget(TIER) };
}

function buildGraph(leadSleep?: number) {
  return createDeepResearchGraph({
    leadModel: new FakeListChatModel({
      responses: [
        '{"jurisdiction":"RU","brief":"Рынок CRM"}',
        '{"action":"RESEARCH","subQuestion":"объём рынка"}',
        '{"action":"COMPLETE","subQuestion":""}',
      ],
      sleep: leadSleep,
    }),
    workerModel: new FakeListChatModel({ responses: ['собран материал'] }),
    compressModel: new FakeListChatModel({ responses: ['дайджест'] }),
    reportModel: new FakeListChatModel({ responses: ['# Итоговый отчёт\nКлючевые выводы'] }),
    tools: [],
    tier: TIER,
    now: NOW,
    nonce: NONCE,
  });
}

describe('runDeepResearch', () => {
  it('returns a completed report on the normal path', async () => {
    const result = await runDeepResearch({
      graph: buildGraph(),
      input: { messages: [new HumanMessage('изучи рынок CRM')] },
      configurable: configurable(),
      wallClockMs: 60_000,
    });
    expect(result.finalizeReason).toBe('completed');
    expect(result.finalReport).toContain('Итоговый отчёт');
    expect(result.findings).toHaveLength(1);
  });

  it('returns an aborted partial report when the external signal is already aborted', async () => {
    const result = await runDeepResearch({
      graph: buildGraph(),
      input: { messages: [new HumanMessage('go')] },
      configurable: configurable(),
      signal: AbortSignal.abort(),
      wallClockMs: 60_000,
    });
    expect(result.finalizeReason).toBe('aborted');
    expect(result.finalReport).toContain('частичный отчёт');
  });

  it('returns a time-limited partial report when the wall-clock cap is hit', async () => {
    const result = await runDeepResearch({
      graph: buildGraph(100),
      input: { messages: [new HumanMessage('go')] },
      configurable: configurable(),
      wallClockMs: 5,
    });
    expect(result.finalizeReason).toBe('time');
    expect(result.finalReport).toContain('частичный отчёт');
  });

  it('streams the REPORT tokens and surfaces research progress', async () => {
    const graph = createDeepResearchGraph({
      leadModel: new FakeListChatModel({
        responses: [
          '{"jurisdiction":"RU","brief":"b"}',
          '{"action":"RESEARCH","subQuestion":"объём рынка"}',
          '{"action":"COMPLETE","subQuestion":""}',
        ],
      }),
      workerModel: new FakeListChatModel({ responses: ['материал'] }),
      compressModel: new FakeListChatModel({ responses: ['дайджест'] }),
      reportModel: new FakeStreamingChatModel({ responses: [new AIMessage('# Отчёт готов')] }),
      tools: [],
      tier: TIER,
      now: NOW,
      nonce: NONCE,
    });

    const tokens: string[] = [];
    const progress: DeepResearchProgress[] = [];
    const result = await runDeepResearch({
      graph,
      input: { messages: [new HumanMessage('изучи рынок')] },
      configurable: configurable(),
      wallClockMs: 60_000,
      onToken: (text) => tokens.push(text),
      onProgress: (event) => progress.push(event),
    });

    expect(result.finalizeReason).toBe('completed');
    expect(tokens.join('')).toContain('Отчёт готов');
    expect(progress.some((p) => p.type === 'research' && p.subQuestion === 'объём рынка')).toBe(
      true,
    );
    expect(progress.some((p) => p.type === 'report')).toBe(true);
  });

  it('finalizes a round-capped partial when the recursion limit is hit (L8)', async () => {
    // A supervisor that never concludes (single cycling RESEARCH response) loops
    // forever; with the token gate disabled and a tiny recursionLimit, langgraph
    // throws GraphRecursionError, which must surface as a 'rounds' partial, not a
    // generic engine error.
    const graph = createDeepResearchGraph({
      leadModel: new FakeListChatModel({ responses: ['{"action":"RESEARCH","subQuestion":"q"}'] }),
      workerModel: new FakeListChatModel({ responses: ['материал'] }),
      compressModel: new FakeListChatModel({ responses: ['дайджест'] }),
      reportModel: new FakeListChatModel({ responses: ['# Отчёт'] }),
      tools: [],
      tier: TIER,
      now: NOW,
      nonce: NONCE,
    });

    const result = await runDeepResearch({
      graph,
      input: { messages: [new HumanMessage('go')] },
      configurable: {
        runId: 'r',
        userId: 'u',
        mode: 'deep',
        budget: { wallClockMs: 900_000, tokenBudget: 0, budgetGateRatio: 0.75 },
      },
      wallClockMs: 60_000,
      recursionLimit: 5,
    });

    expect(result.finalizeReason).toBe('rounds');
    expect(result.finalReport).toContain('частичный отчёт');
  });
});
