import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import { FakeListChatModel } from '@langchain/core/utils/testing';
import { HumanMessage, AIMessageChunk } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { DeepResearchConfigurable } from './state';
import type { DeepResearchNode } from './graph';
import { buildDeepResearchGraph, createDeepResearchGraph } from './graph';
import { createSupervisorNode } from './nodes/supervisor';
import { resolveDeepResearchTier } from './config';
import { createScopeNode } from './nodes/scope';

/** Worker fake that CALLS web_search once then answers — so the researcher gathers
 *  REAL tool material (the honest-report gate refuses placeholder-only findings). */
function fakeToolWorker(): BaseChatModel {
  let turn = 0;
  const caller = {
    invoke: async () =>
      turn++ === 0
        ? new AIMessageChunk({
            content: '',
            tool_calls: [
              {
                name: 'web_search',
                args: { query: 'объём рынка CRM' },
                id: 'c1',
                type: 'tool_call',
              },
            ],
          })
        : new AIMessageChunk({ content: 'материал собран' }),
  };
  return { bindTools: () => caller } as unknown as BaseChatModel;
}

const webSearchTool = tool(async ({ query }: { query: string }) => `данные по ${query}`, {
  name: 'web_search',
  description: 'поиск',
  schema: z.object({ query: z.string() }),
});

const NOW = '2026-06-25T00:00:00Z';
const NONCE = 'test-nonce';
const TIER = resolveDeepResearchTier(); // deep: maxOrchestratorCycles = 8

const scopeNode = () =>
  createScopeNode({
    model: new FakeListChatModel({ responses: ['{"jurisdiction":"RU","brief":"b"}'] }),
    now: NOW,
  });

const supervisorNode = (responses: string[]) =>
  createSupervisorNode({
    model: new FakeListChatModel({ responses }),
    tier: TIER,
    now: NOW,
    nonce: NONCE,
  });

/** Stub researcher: records one finding and a simulated token cost per round. */
const stubResearcher =
  (costPerRound: number): DeepResearchNode =>
  async (state) => ({
    findings: [
      {
        round: state.round,
        subQuestion: state.currentSubQuestion,
        digest: `дайджест по «${state.currentSubQuestion}»`,
        sources: [],
        tokens: costPerRound,
      },
    ],
    tokenUsage: { input: costPerRound, output: 0, total: costPerRound },
  });

/** Stub terminal report: maps concludeReason → finalizeReason. */
const stubReport: DeepResearchNode = async (state) => ({
  finalReport: `ОТЧЁТ по ${state.findings.length} находкам`,
  finalizeReason: state.concludeReason === 'budget' ? 'budget' : 'completed',
});

function runConfig(tokenBudget: number, budgetGateRatio = 0.75): RunnableConfig {
  const configurable: DeepResearchConfigurable = {
    runId: 'run-1',
    userId: 'user-1',
    mode: 'deep',
    budget: { wallClockMs: 900_000, tokenBudget, budgetGateRatio, timeGateRatio: 0.68 },
  };
  return { configurable, recursionLimit: 256 };
}

describe('buildDeepResearchGraph (termination guarantees)', () => {
  it('gathers, then concludes via the model → REPORT', async () => {
    const graph = buildDeepResearchGraph({
      scope: scopeNode(),
      supervisor: supervisorNode([
        '{"action":"RESEARCH","subQuestion":"q1"}',
        '{"action":"RESEARCH","subQuestion":"q2"}',
        '{"action":"COMPLETE","subQuestion":""}',
      ]),
      researcher: stubResearcher(1_000),
      report: stubReport,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage('изучи рынок CRM')] },
      runConfig(800_000),
    );

    expect(result.jurisdiction).toBe('RU');
    expect(result.findings).toHaveLength(2);
    expect(result.finalReport).toContain('ОТЧЁТ');
    expect(result.finalizeReason).toBe('completed');
  });

  it('budget gate forces REPORT even if the model NEVER concludes', async () => {
    const graph = buildDeepResearchGraph({
      scope: scopeNode(),
      supervisor: supervisorNode(['{"action":"RESEARCH","subQuestion":"q"}']), // always research
      researcher: stubResearcher(300_000), // 800k * 0.75 = 600k gate → trips after 2 researchers
      report: stubReport,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage('go')] },
      runConfig(800_000, 0.75),
    );

    expect(result.finalReport).toContain('ОТЧЁТ');
    expect(result.finalizeReason).toBe('budget');
    expect(result.findings.length).toBeGreaterThanOrEqual(1);
    expect(result.findings.length).toBeLessThanOrEqual(3);
  });

  it('soft TIME gate forces REPORT and the model still writes it — completed, not partial (A1)', async () => {
    const graph = buildDeepResearchGraph({
      scope: scopeNode(),
      supervisor: createSupervisorNode({
        model: new FakeListChatModel({ responses: ['{"action":"RESEARCH","subQuestion":"q"}'] }), // would keep researching
        tier: TIER,
        now: NOW,
        nonce: NONCE,
        clock: () => 5_000, // "current time" is already past the soft deadline below
      }),
      researcher: stubResearcher(1_000),
      report: stubReport,
    });

    const configurable: DeepResearchConfigurable = {
      runId: 'run-1',
      userId: 'user-1',
      mode: 'deep',
      budget: { wallClockMs: 900_000, tokenBudget: 0, budgetGateRatio: 1, timeGateRatio: 0.68 },
      softDeadlineMs: 1_000,
    };
    const result = await graph.invoke(
      { messages: [new HumanMessage('go')] },
      { configurable, recursionLimit: 256 },
    );

    expect(result.concludeReason).toBe('time'); // the wall-clock synthesis-reserve gate fired
    expect(result.findings).toHaveLength(0); // ...before ANY researcher was dispatched
    expect(result.finalReport).toContain('ОТЧЁТ'); // the model still wrote the report
    expect(result.finalizeReason).toBe('completed'); // a healthy completion, NOT a "partial: time"
  });

  it('round cap forces REPORT even with a huge budget and a never-concluding model', async () => {
    const graph = buildDeepResearchGraph({
      scope: scopeNode(),
      supervisor: supervisorNode(['{"action":"RESEARCH","subQuestion":"q"}']),
      researcher: stubResearcher(1),
      report: stubReport,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage('go')] },
      runConfig(1_000_000_000, 0.75),
    );

    expect(result.finalReport).toContain('ОТЧЁТ');
    expect(result.finalizeReason).toBe('completed');
    expect(result.findings).toHaveLength(TIER.maxOrchestratorCycles);
  });
});

describe('createDeepResearchGraph (full assembly, all real nodes)', () => {
  it('runs SCOPE → SUPERVISOR → RESEARCHER → REPORT end-to-end on fakes', async () => {
    const graph = createDeepResearchGraph({
      // lead model serves scope, then supervisor (research, then complete), in call order
      leadModel: new FakeListChatModel({
        responses: [
          '{"jurisdiction":"RU","brief":"Рынок CRM в РФ"}',
          '{"action":"RESEARCH","subQuestion":"объём рынка"}',
          '{"action":"COMPLETE","subQuestion":""}',
        ],
      }),
      workerModel: fakeToolWorker(),
      compressModel: new FakeListChatModel({ responses: ['дайджест'] }),
      reportModel: new FakeListChatModel({
        responses: ['# Итоговый отчёт\nКлючевые выводы: рынок растёт.'],
      }),
      tools: [webSearchTool],
      tier: TIER,
      now: NOW,
      nonce: NONCE,
    });

    const result = await graph.invoke(
      { messages: [new HumanMessage('изучи рынок CRM в России')] },
      runConfig(800_000),
    );

    expect(result.jurisdiction).toBe('RU');
    expect(result.findings).toHaveLength(1);
    expect(result.finalReport).toContain('Итоговый отчёт');
    expect(result.finalizeReason).toBe('completed');
    // C2 regression: real node usage must accumulate. FakeListChatModel reports no
    // usage_metadata, so this is the length-estimate fallback flowing node→state.
    // Before the fix tokenUsage.total stayed 0 and the budget gate was a no-op.
    expect(result.tokenUsage.total).toBeGreaterThan(0);
  });

  it('budget gate trips on REAL accumulated node usage, not just stubbed tokenUsage', async () => {
    // A budget of 1 token trips the gate as soon as ANY real usage accrues. With
    // all-real nodes and a model that never concludes, this proves usage flows
    // from the nodes into the gate via usageFromExchange (the C2 fix end-to-end).
    const graph = createDeepResearchGraph({
      leadModel: new FakeListChatModel({
        responses: [
          '{"jurisdiction":"RU","brief":"Рынок"}',
          '{"action":"RESEARCH","subQuestion":"q1"}',
        ],
      }),
      workerModel: fakeToolWorker(),
      compressModel: new FakeListChatModel({ responses: ['дайджест'] }),
      reportModel: new FakeListChatModel({ responses: ['# Отчёт'] }),
      tools: [webSearchTool],
      tier: TIER,
      now: NOW,
      nonce: NONCE,
    });

    const result = await graph.invoke({ messages: [new HumanMessage('go')] }, runConfig(1, 1));

    expect(result.tokenUsage.total).toBeGreaterThan(0);
    // The 1-token budget trips BEFORE any research ran, so the state proves the gate
    // fired on real usage — and the report is the honest "no material" notice, never
    // a fake analytical note written out of zero findings.
    expect(result.concludeReason).toBe('budget');
    expect(result.finalizeReason).toBe('nodata');
    expect(result.finalReport).toContain('Не удалось собрать материал');
  });
});
