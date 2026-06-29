import { HumanMessage } from '@langchain/core/messages';
import { FakeListChatModel } from '@langchain/core/utils/testing';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';

import type { BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import type { BaseChatModelParams } from '@langchain/core/language_models/chat_models';
import type { DeepResearchConfigurable } from './state';
import { resolveDeepResearchTier, tierToRunBudget } from './config';
import { createDeepResearchGraph } from './graph';
import { runDeepResearch } from './run';

const NOW = '2026-06-25T00:00:00Z';
const NONCE = 'test-nonce';
const TIER = resolveDeepResearchTier();

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
  it('still produces a report when the report model fails (5xx)', async () => {
    const graph = createDeepResearchGraph({
      leadModel: new FakeListChatModel({
        responses: [
          '{"jurisdiction":"RU","brief":"b"}',
          '{"action":"RESEARCH","subQuestion":"q1"}',
          '{"action":"COMPLETE","subQuestion":""}',
        ],
      }),
      workerModel: new FakeListChatModel({ responses: ['материал'] }),
      compressModel: new FakeListChatModel({ responses: ['дайджест'] }),
      reportModel: new ThrowingChatModel('503 service unavailable'),
      tools: [],
      tier: TIER,
      now: NOW,
      nonce: NONCE,
    });

    const result = await run(graph);
    expect(result.finalReport).toContain('частичный отчёт');
    expect(result.findings).toHaveLength(1);
    expect(result.finalizeReason).toBe('completed');
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
    expect(result.finalizeReason).toBe('completed');
  });

  it('produces a fallback even when research is empty and the report model is down', async () => {
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
    expect(result.finalReport).toContain('не удалось собрать данные');
    expect(result.findings).toHaveLength(0);
  });
});
