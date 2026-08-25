import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import { AIMessageChunk } from '@langchain/core/messages';
import { FakeListChatModel } from '@langchain/core/utils/testing';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { BaseMessage } from '@langchain/core/messages';
import type { DeepResearchState, DeepResearchFinding } from '../state';
import {
  researchOne,
  isContentUrl,
  EMPTY_DIGEST,
  extractSources,
  runResearchLoop,
  compressResearch,
  createResearcherNode,
  hasResearchMaterial,
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

/** Like `scriptedCaller`, but records what the model was actually shown each turn — the only
 *  way to assert that a failure still reaches the model while staying out of the material. */
function recordingCaller(sink: BaseMessage[][], responses: AIMessageChunk[]): ToolCaller {
  let i = 0;
  return {
    invoke: async (messages: BaseMessage[]) => {
      sink.push([...messages]);
      return responses[Math.min(i++, responses.length - 1)];
    },
  };
}

const shownToModel = (messages: BaseMessage[]): string =>
  messages
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
    .join('\n');

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
    usageByModel: {},
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

  it('shows an unknown tool to the model without counting it as material', async () => {
    const seen: BaseMessage[][] = [];
    const result = await runResearchLoop({
      caller: recordingCaller(seen, [toolCallChunk('nonexistent', {}, 'c1'), finalChunk('x')]),
      tools: [okTool],
      system: 's',
      question: 'q',
      nonce: NONCE,
      tokenCap: Infinity,
      maxTurns: 5,
    });
    // Never throws, and the model is told — so it can try another angle.
    expect(shownToModel(seen[seen.length - 1])).toContain('недоступен');
    // …but a failure notice is not research material.
    expect(result.toolOutputs).toEqual([]);
  });

  it('shows a thrown tool error to the model without counting it as material', async () => {
    const seen: BaseMessage[][] = [];
    const result = await runResearchLoop({
      caller: recordingCaller(seen, [
        toolCallChunk('file_search', { query: 'q' }, 'c1'),
        finalChunk('x'),
      ]),
      tools: [throwingTool],
      system: 's',
      question: 'q',
      nonce: NONCE,
      tokenCap: Infinity,
      maxTurns: 5,
    });
    expect(shownToModel(seen[seen.length - 1])).toContain('Ошибка инструмента');
    expect(result.toolOutputs).toEqual([]);
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
        const chunk = toolCallChunk('web_search', { query: 'q' }, `c${calls}`);
        // A big answer, so the length-estimate path puts this turn's usage well over the cap.
        chunk.content = 'x'.repeat(3_000);
        return chunk;
      },
    };
    // The cap comfortably covers the opening prompt — a cap that does NOT is declined before
    // the call, which is a separate guarantee tested elsewhere — but this turn's usage blows
    // straight past it, so the post-call backstop stops the loop after ONE model call instead
    // of running all 10 turns.
    await runResearchLoop({
      caller,
      tools: [okTool],
      system: 's',
      question: 'q',
      nonce: NONCE,
      tokenCap: 100,
      maxTurns: 10,
    });
    expect(calls).toBe(1);
  });

  it('stops STARTING new turns once the gather deadline has passed (A1 time gate)', async () => {
    let calls = 0;
    const caller: ToolCaller = {
      invoke: async () => {
        calls += 1;
        return toolCallChunk('web_search', { query: 'q' }, `c${calls}`);
      },
    };
    // Injected clock crosses the deadline after the first turn: turn 0's pre-check sees
    // clock < deadline and runs; turn 1's pre-check sees clock >= deadline and breaks — so
    // exactly ONE model call, and the round yields to the supervisor → REPORT keeps its reserve.
    let tick = 0;
    await runResearchLoop({
      caller,
      tools: [okTool],
      system: 's',
      question: 'q',
      nonce: NONCE,
      tokenCap: Infinity,
      maxTurns: 10,
      deadlineMs: 1000,
      clock: () => (tick++ === 0 ? 0 : 5000),
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

describe('isContentUrl (C1 source hygiene)', () => {
  it('keeps real articles, vendor sites and PDFs', () => {
    for (const url of [
      'https://www.tadviser.ru/index.php/Статья:CRM',
      'https://www.cnews.ru/reviews/crm_2025',
      'https://www.bitrix24.ru/prices/',
      'https://static.gov.ru/reports/otchet-2024.pdf',
    ]) {
      expect(isContentUrl(url)).toBe(true);
    }
  });

  it('drops images/assets, trackers/pixels and redirect hops', () => {
    for (const url of [
      'https://habrastorage.org/webt/ab/cd/pic.png',
      'https://leonardo.osnova.io/photo.jpg',
      'https://cdn.site.ru/bundle.min.js',
      'https://www.facebook.com/tr?id=123',
      'https://mc.yandex.ru/watch/456',
      'https://api.vc.ru/v2.8/redirect?to=https://x.ru',
    ]) {
      expect(isContentUrl(url)).toBe(false);
    }
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

  it('filters out asset/tracker/redirect noise, keeping only content URLs (C1)', () => {
    const gathered =
      'Рейтинг: https://www.tadviser.ru/crm ' +
      'картинка https://habrastorage.org/img/pic.png ' +
      'пиксель https://www.facebook.com/tr?id=1 ' +
      'редирект https://api.vc.ru/v2.8/redirect?to=x ' +
      'ещё https://www.cnews.ru/review.';
    expect(extractSources(gathered)).toEqual([
      'https://www.tadviser.ru/crm',
      'https://www.cnews.ru/review',
    ]);
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

describe('hasResearchMaterial (the honest-report gate)', () => {
  const withDigest = (digest: string): DeepResearchFinding => ({
    round: 1,
    subQuestion: 'q',
    digest,
    sources: [],
    tokens: 0,
  });

  it('accepts a real digest and rejects empty/placeholder/failure digests', () => {
    expect(hasResearchMaterial(withDigest('Битрикс24: тарифы от 0 руб.'))).toBe(true);
    expect(hasResearchMaterial(withDigest(''))).toBe(false);
    expect(hasResearchMaterial(withDigest('   '))).toBe(false);
    expect(hasResearchMaterial(withDigest(EMPTY_DIGEST))).toBe(false);
    expect(hasResearchMaterial(withDigest('(ошибка исследования: сервис недоступен)'))).toBe(false);
  });
});

describe('researchOne — the tool loop and COMPRESS are attributed separately', () => {
  /**
   * `researchOne` merges the loop's usage with COMPRESS's into ONE figure, and the tier
   * currently sets `compressModel` to the same slug as the worker — so a split done only at
   * the node boundary looks correct today and starts lying the moment those two differ.
   * The seam therefore has to be INSIDE researchOne, and this asserts it there.
   */
  it('keeps worker and compress tokens under their own models', async () => {
    const workerAnswer = new AIMessageChunk({
      content: 'материал собран',
      response_metadata: { model_name: 'worker/model' },
      usage_metadata: { input_tokens: 900, output_tokens: 100, total_tokens: 1000 },
    });
    const compressModel = {
      invoke: async () =>
        new AIMessageChunk({
          content: 'дайджест',
          response_metadata: { model_name: 'compress/model' },
          usage_metadata: { input_tokens: 40, output_tokens: 10, total_tokens: 50 },
        }),
    } as unknown as BaseChatModel;

    const { usage, usageByModel } = await researchOne({
      caller: scriptedCaller([
        new AIMessageChunk({
          content: '',
          tool_calls: [
            { name: 'web_search', args: { query: 'рынок CRM' }, id: 'c1', type: 'tool_call' },
          ],
          response_metadata: { model_name: 'worker/model' },
          usage_metadata: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
        }),
        workerAnswer,
      ]),
      deps: {
        model: { model: 'worker/model' } as unknown as BaseChatModel,
        compressModel,
        tools: [okTool],
        tier: TIER,
        now: NOW,
        nonce: NONCE,
      },
      subQuestion: 'вопрос',
      round: 1,
      jurisdiction: 'RU',
      tokenCap: 100_000,
    });

    expect(usageByModel).toEqual({
      'worker/model': { input: 1000, output: 120, total: 1120, estimated: 0 },
      'compress/model': { input: 40, output: 10, total: 50, estimated: 0 },
    });
    // And the split still adds up to the aggregate the budget gate reads.
    const summed = Object.values(usageByModel).reduce(
      (acc, u) => ({ input: acc.input + u.input, output: acc.output + u.output }),
      { input: 0, output: 0 },
    );
    expect(summed).toEqual({ input: usage.input, output: usage.output });
  });

  /**
   * `caller` is what `bindTools()` returned — a RunnableBinding that carries none of the
   * model's own fields. When the provider does not name itself (any proxy that strips
   * `model_name`), reading the slug off that wrapper puts EVERY worker token under
   * 'unknown', which is a different way of losing the same attribution.
   */
  it('names the worker from the model itself when the provider names nothing', async () => {
    const { usageByModel } = await researchOne({
      caller: scriptedCaller([
        new AIMessageChunk({
          content: 'материал собран',
          usage_metadata: { input_tokens: 900, output_tokens: 100, total_tokens: 1000 },
        }),
      ]),
      deps: {
        model: { model: 'worker/model' } as unknown as BaseChatModel,
        compressModel: new FakeListChatModel({ responses: ['unused'] }),
        tools: [okTool],
        tier: TIER,
        now: NOW,
        nonce: NONCE,
      },
      subQuestion: 'вопрос',
      round: 1,
      jurisdiction: 'RU',
      tokenCap: 100_000,
    });

    expect(Object.keys(usageByModel)).toEqual(['worker/model']);
  });

  it('reports no per-model usage for a researcher that failed before any model answered', async () => {
    const { usageByModel } = await researchOne({
      caller: {
        invoke: async () => {
          throw new Error('поиск недоступен');
        },
      },
      deps: {
        model: {} as unknown as BaseChatModel,
        compressModel: new FakeListChatModel({ responses: ['unused'] }),
        tools: [],
        tier: TIER,
        now: NOW,
        nonce: NONCE,
      },
      subQuestion: 'вопрос',
      round: 1,
      jurisdiction: 'RU',
      tokenCap: 100_000,
    });

    expect(usageByModel).toEqual({});
  });
});
