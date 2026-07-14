import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import { FakeListChatModel } from '@langchain/core/utils/testing';
import { HumanMessage, AIMessageChunk } from '@langchain/core/messages';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseChatModelParams } from '@langchain/core/language_models/chat_models';
import type { BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import type { DeepResearchConfigurable } from './state';
import { resolveDeepResearchTier, tierToRunBudget } from './config';
import { createDeepResearchGraph } from './graph';
import { runDeepResearch } from './run';

const NOW = '2026-06-25T00:00:00Z';
const NONCE = 'test-nonce';
const TIER = resolveDeepResearchTier();

/** Worker fake that calls web_search once then answers — yields REAL tool material. */
function fakeToolWorker(): BaseChatModel {
  let turn = 0;
  const caller = {
    invoke: async () =>
      turn++ === 0
        ? new AIMessageChunk({
            content: '',
            tool_calls: [{ name: 'web_search', args: { query: 'q' }, id: 'c1', type: 'tool_call' }],
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

/** A chat model that always throws — simulates a 5xx/down upstream. No tool binding needed. */
class ThrowingChatModel extends BaseChatModel {
  private readonly failure: string;
  constructor(failure: string) {
    super({} as BaseChatModelParams);
    this.failure = failure;
  }

  _llmType(): string {
    return 'throwing';
  }

  async _generate(_messages: BaseMessage[]): Promise<ChatResult> {
    throw new Error(this.failure);
  }
}

function configurable(): DeepResearchConfigurable {
  return { runId: 'run-1', userId: 'user-1', mode: 'deep', budget: tierToRunBudget(TIER) };
}

const run = (graph: ReturnType<typeof createDeepResearchGraph>) =>
  runDeepResearch({
    graph,
    input: { messages: [new HumanMessage('изучи рынок')] },
    configurable: configurable(),
    wallClockMs: 60_000,
  });

describe('chaos — REPORT always fires', () => {
  it('degrades gracefully (honest notice, no throw) when the report model fails (5xx)', async () => {
    const graph = createDeepResearchGraph({
      leadModel: new FakeListChatModel({
        responses: [
          '{"jurisdiction":"RU","brief":"b"}',
          '{"action":"RESEARCH","subQuestion":"q1"}',
          '{"action":"COMPLETE","subQuestion":""}',
        ],
      }),
      workerModel: fakeToolWorker(),
      compressModel: new FakeListChatModel({ responses: ['дайджест'] }),
      reportModel: new ThrowingChatModel('503 service unavailable'),
      tools: [webSearchTool],
      tier: TIER,
      now: NOW,
      nonce: NONCE,
    });

    const result = await run(graph);
    // No throw, no faked "completed": a report-model failure is an honest 'error' notice,
    // never the old raw findings dump (owner: no partial reports).
    expect(result.finalReport).toContain('Не удалось сформировать отчёт');
    expect(result.findings).toHaveLength(1);
    expect(result.finalizeReason).toBe('error');
  });

  it('terminates with a report when the supervisor returns non-JSON garbage', async () => {
    const graph = createDeepResearchGraph({
      leadModel: new FakeListChatModel({
        responses: ['{"jurisdiction":"RU","brief":"b"}', 'это вообще не json', 'опять мусор'],
      }),
      workerModel: new FakeListChatModel({ responses: ['x'] }),
      compressModel: new FakeListChatModel({ responses: ['x'] }),
      reportModel: new FakeListChatModel({ responses: ['# Отчёт'] }),
      tools: [],
      tier: TIER,
      now: NOW,
      nonce: NONCE,
    });

    const result = await run(graph);
    expect(result.finalReport).toBeTruthy();
    // Garbage output no longer silently "completes": each unparseable round degrades to
    // researching the brief itself until the rounds gate stops the loop; with no real
    // material gathered the run finalizes as an HONEST no-data notice.
    expect(result.finalizeReason).toBe('nodata');
    expect(result.finalReport).toContain('Не удалось собрать материал');
  });

  it('refuses a fake report when research came up empty — honest notice, report model never called', async () => {
    const graph = createDeepResearchGraph({
      leadModel: new FakeListChatModel({
        responses: ['{"jurisdiction":"RU","brief":"b"}', '{"action":"COMPLETE","subQuestion":""}'],
      }),
      workerModel: new FakeListChatModel({ responses: ['x'] }),
      compressModel: new FakeListChatModel({ responses: ['x'] }),
      reportModel: new ThrowingChatModel('down'),
      tools: [],
      tier: TIER,
      now: NOW,
      nonce: NONCE,
    });

    const result = await run(graph);
    // The round-0 anti-complete guard forces ONE real research attempt (1 placeholder
    // finding), then the honest no-data notice ships DETERMINISTICALLY — the throwing
    // report model is never invoked.
    expect(result.finalReport).toContain('Не удалось собрать материал');
    expect(result.finalizeReason).toBe('nodata');
    expect(result.findings.length).toBeGreaterThanOrEqual(1);
  });
});
