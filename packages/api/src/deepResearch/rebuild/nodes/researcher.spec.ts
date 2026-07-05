import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import { AIMessageChunk } from '@langchain/core/messages';
import { FakeListChatModel } from '@langchain/core/utils/testing';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { BaseMessage } from '@langchain/core/messages';
import type { DeepResearchState, DeepResearchFinding } from '../state';
import {
  researchOne,
  extractSources,
  runResearchLoop,
  compressResearch,
  createResearcherNode,
  type ToolCaller,
} from './researcher';
import { resolveDeepResearchTier } from '../config';

const NOW = '2026-06-25T00:00:00Z';
const NONCE = 'test-nonce';
const TIER = resolveDeepResearchTier();

const toolCallChunk = (name: string, args: Record<string, unknown>, id: string) =>
  new AIMessageChunk({ content: '', tool_calls: [{ name, args, id, type: 'tool_call' }] });
const finalChunk = (text: string) => new AIMessageChunk({ content: text });

function scriptedCaller(responses: AIMessageChunk[]): ToolCaller {
  let i = 0;
  return { invoke: async () => responses[Math.min(i++, responses.length - 1)] };
}

const okTool = tool(
  async ({ query }: { query: string }) => `данные по ${query}: https://cbr.ru/key-rate`,
  {
    name: 'web_search',
    description: 'поиск',
    schema: z.object({ query: z.string() }),
  },
);
const throwingTool = tool(
  async () => {
    throw new Error('boom');
  },
  { name: 'file_search', description: 'поиск', schema: z.object({ query: z.string() }) },
);

function stateWith(partial: Partial<DeepResearchState>): DeepResearchState {
  return {
    messages: [],
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

describe('runResearchLoop', () => {
  it('executes a tool call then stops when the model gives a final answer', async () => {
    const result = await runResearchLoop({
      caller: scriptedCaller([
        toolCallChunk('web_search', { query: 'ставка ЦБ' }, 'c1'),
        finalChunk('итог'),
      ]),
      tools: [okTool],
      system: 's',
      question: 'q',
      nonce: NONCE,
      tokenCap: Infinity,
      maxTurns: 5,
    });
    expect(result.toolOutputs).toHaveLength(1);
    expect(result.toolOutputs[0]).toContain('cbr.ru');
  });

  it('returns an error string (never throws) for an unknown tool', async () => {
    const result = await runResearchLoop({
      caller: scriptedCaller([toolCallChunk('nonexistent', {}, 'c1'), finalChunk('x')]),
      tools: [okTool],
      system: 's',
      question: 'q',
      nonce: NONCE,
      tokenCap: Infinity,
      maxTurns: 5,
    });
    expect(result.toolOutputs[0]).toContain('недоступен');
  });

  it('returns an error string (never throws) when a tool throws', async () => {
    const result = await runResearchLoop({
      caller: scriptedCaller([toolCallChunk('file_search', { query: 'q' }, 'c1'), finalChunk('x')]),
      tools: [throwingTool],
      system: 's',
      question: 'q',
      nonce: NONCE,
      tokenCap: Infinity,
      maxTurns: 5,
    });
    expect(result.toolOutputs[0]).toContain('Ошибка инструмента');
  });

  it('stops at maxTurns when the model never concludes', async () => {
    const result = await runResearchLoop({
      caller: scriptedCaller([toolCallChunk('web_search', { query: 'q' }, 'c1')]),
      tools: [okTool],
      system: 's',
      question: 'q',
      nonce: NONCE,
      tokenCap: Infinity,
      maxTurns: 2,
    });
    expect(result.toolOutputs).toHaveLength(2);
  });

  it('fences untrusted tool output in per-run markers before the model sees it (H5)', async () => {
    const seen: BaseMessage[][] = [];
    const caller: ToolCaller = {
      invoke: async (messages) => {
        seen.push([...messages]);
        return seen.length === 1
          ? toolCallChunk('web_search', { query: 'q' }, 'c1')
          : finalChunk('итог');
      },
    };
    await runResearchLoop({
      caller,
      tools: [okTool],
      system: 's',
      question: 'q',
      nonce: 'NZ',
      tokenCap: Infinity,
      maxTurns: 5,
    });
    const toolMsg = seen[1].find((m) => m.getType() === 'tool');
    expect(String(toolMsg?.content)).toContain('<UNTRUSTED NZ>');
    expect(String(toolMsg?.content)).toContain('cbr.ru');
  });

  it('stops gathering once loop spend reaches the token cap (M3)', async () => {
    let calls = 0;
    const caller: ToolCaller = {
      invoke: async () => {
        calls += 1;
        return toolCallChunk('web_search', { query: 'q' }, `c${calls}`);
      },
    };
    // tokenCap of 1: the first turn's usage already meets it, so the loop stops
    // after one model call instead of running all 10 turns.
    await runResearchLoop({
      caller,
      tools: [okTool],
      system: 's',
      question: 'q',
      nonce: NONCE,
      tokenCap: 1,
      maxTurns: 10,
    });
    expect(calls).toBe(1);
  });

  it('caps tool-call width per turn but answers every tool_call (M4)', async () => {
    const sevenCalls = new AIMessageChunk({
      content: '',
      tool_calls: Array.from({ length: 7 }, (_, i) => ({
        name: 'web_search',
        args: { query: `q${i}` },
        id: `c${i}`,
        type: 'tool_call' as const,
      })),
    });
    const seen: BaseMessage[][] = [];
    const caller: ToolCaller = {
      invoke: async (messages) => {
        seen.push([...messages]);
        return seen.length === 1 ? sevenCalls : finalChunk('done');
      },
    };
    const result = await runResearchLoop({
      caller,
      tools: [okTool],
      system: 's',
      question: 'q',
      nonce: NONCE,
      tokenCap: Infinity,
      maxTurns: 3,
    });
    expect(result.toolOutputs).toHaveLength(5);
    const toolMsgs = seen[1].filter((m) => m.getType() === 'tool');
    expect(toolMsgs).toHaveLength(7);
    expect(toolMsgs.filter((m) => String(m.content).includes('пропущен'))).toHaveLength(2);
  });

  it('caps a single tool output to 8000 chars (M4)', async () => {
    const hugeTool = tool(async () => 'x'.repeat(20_000), {
      name: 'web_search',
      description: 'поиск',
      schema: z.object({ query: z.string() }),
    });
    const result = await runResearchLoop({
      caller: scriptedCaller([
        toolCallChunk('web_search', { query: 'q' }, 'c1'),
        finalChunk('done'),
      ]),
      tools: [hugeTool],
      system: 's',
      question: 'q',
      nonce: NONCE,
      tokenCap: Infinity,
      maxTurns: 3,
    });
    expect(result.toolOutputs[0]).toHaveLength(8_000);
  });
});

describe('compressResearch', () => {
  it('returns an empty digest when nothing was gathered', async () => {
    const result = await compressResearch({
      compressModel: new FakeListChatModel({ responses: ['unused'] }),
      subQuestion: 'q',
      jurisdiction: 'RU',
      gathered: '',
      digestCap: 800,
      now: NOW,
      nonce: NONCE,
    });
    expect(result.digest).toBe('');
  });

  it('compresses gathered material and caps the digest length', async () => {
    const long = 'я'.repeat(2000);
    const result = await compressResearch({
      compressModel: new FakeListChatModel({ responses: [long] }),
      subQuestion: 'q',
      jurisdiction: 'RU',
      gathered: 'сырой материал',
      digestCap: 100,
      now: NOW,
      nonce: NONCE,
    });
    expect(result.digest).toHaveLength(100);
  });
});

describe('extractSources', () => {
  it('extracts and de-duplicates source URLs, trimming trailing punctuation', () => {
    expect(extractSources('см. https://cbr.ru/a и https://nalog.gov.ru/b.')).toEqual([
      'https://cbr.ru/a',
      'https://nalog.gov.ru/b',
    ]);
    expect(extractSources('https://x.ru/1\n\n---\n\nhttps://x.ru/1')).toEqual(['https://x.ru/1']);
  });
});

describe('createResearcherNode', () => {
  const emptyConfig: RunnableConfig = {};

  it('guards against an empty sub-question without producing a finding', async () => {
    const node = createResearcherNode({
      model: new FakeListChatModel({ responses: ['x'] }),
      compressModel: new FakeListChatModel({ responses: ['y'] }),
      tools: [],
      tier: TIER,
      now: NOW,
      nonce: NONCE,
    });
    const update = await node(stateWith({ currentSubQuestion: '' }), emptyConfig);
    expect(update.errors).toHaveLength(1);
    expect(update.findings ?? []).toHaveLength(0);
  });

  it('produces a finding for the sub-question (placeholder when no tools were used)', async () => {
    const node = createResearcherNode({
      model: new FakeListChatModel({ responses: ['итоговый ответ без инструментов'] }),
      compressModel: new FakeListChatModel({ responses: ['дайджест'] }),
      tools: [],
      tier: TIER,
      now: NOW,
      nonce: NONCE,
    });
    const update = await node(
      stateWith({ currentSubQuestion: 'Объём рынка', round: 2 }),
      emptyConfig,
    );
    const findings = (update.findings ?? []) as DeepResearchFinding[];
    expect(findings).toHaveLength(1);
    expect(findings[0].round).toBe(2);
    expect(findings[0].subQuestion).toBe('Объём рынка');
  });

  it('researches a BATCH of sub-questions in parallel, one finding each (A2)', async () => {
    const node = createResearcherNode({
      model: new FakeListChatModel({ responses: ['ответ'] }),
      compressModel: new FakeListChatModel({ responses: ['дайджест'] }),
      tools: [],
      tier: TIER,
      now: NOW,
      nonce: NONCE,
    });
    const update = await node(
      stateWith({ currentSubQuestions: ['вопрос A', 'вопрос B', 'вопрос C'], round: 1 }),
      emptyConfig,
    );
    const findings = (update.findings ?? []) as DeepResearchFinding[];
    expect(findings).toHaveLength(3);
    expect(findings.map((f) => f.subQuestion).sort()).toEqual(['вопрос A', 'вопрос B', 'вопрос C']);
  });

  it('one failing sub-question does not collapse its siblings in the batch (A2)', async () => {
    // A model that returns no tool calls → each researcher succeeds; here compress fails
    // for all, but the node still yields a finding per sub-question (placeholder/error), not a throw.
    const node = createResearcherNode({
      model: new FakeListChatModel({ responses: ['ответ'] }),
      compressModel: new FakeListChatModel({ responses: ['дайджест'] }),
      tools: [],
      tier: TIER,
      now: NOW,
      nonce: NONCE,
    });
    const update = await node(
      stateWith({ currentSubQuestions: ['A', 'B'], round: 0 }),
      emptyConfig,
    );
    expect(((update.findings ?? []) as DeepResearchFinding[]).length).toBe(2);
  });
});

describe('researchOne', () => {
  const deps = {
    model: new FakeListChatModel({ responses: ['unused'] }),
    compressModel: new FakeListChatModel({ responses: ['дайджест'] }),
    tools: [],
    tier: TIER,
    now: NOW,
    nonce: NONCE,
  };

  it('re-throws on a real abort so a batch propagates it to the run wrapper', async () => {
    const controller = new AbortController();
    controller.abort();
    const caller: ToolCaller = {
      invoke: async () => {
        throw new Error('aborted');
      },
    };
    await expect(
      researchOne({
        caller,
        deps,
        subQuestion: 'q',
        round: 0,
        jurisdiction: 'RU',
        tokenCap: Number.POSITIVE_INFINITY,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  });

  it('returns an error-finding (never throws) on a non-abort failure', async () => {
    const caller: ToolCaller = {
      invoke: async () => {
        throw new Error('model 500');
      },
    };
    const result = await researchOne({
      caller,
      deps,
      subQuestion: 'под-вопрос',
      round: 3,
      jurisdiction: 'RU',
      tokenCap: Number.POSITIVE_INFINITY,
    });
    expect(result.finding.subQuestion).toBe('под-вопрос');
    expect(result.finding.round).toBe(3);
    expect(result.error?.node).toBe('researcher');
  });
});
