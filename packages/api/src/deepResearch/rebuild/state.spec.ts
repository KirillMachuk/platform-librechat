import { StateGraph, START, END } from '@langchain/langgraph';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import type { DeepResearchState, DeepResearchStateUpdate } from './state';
import { DeepResearchStateAnnotation } from './state';

describe('DeepResearchStateAnnotation', () => {
  it('reduces channels correctly: concat, sum, last-wins, message append', async () => {
    const a = (): DeepResearchStateUpdate => ({
      jurisdiction: 'RU',
      findings: [{ round: 1, subQuestion: 'q1', digest: 'd1', sources: ['s1'], tokens: 10 }],
      tokenUsage: { input: 100, output: 50, total: 150 },
      errors: [{ node: 'a', message: 'oops', at: '2026-06-25T00:00:00Z' }],
      round: 1,
      researcherCount: 1,
      messages: [new AIMessage('from a')],
    });
    const b = (): DeepResearchStateUpdate => ({
      jurisdiction: 'KZ',
      findings: [{ round: 2, subQuestion: 'q2', digest: 'd2', sources: ['s2'], tokens: 20 }],
      tokenUsage: { input: 10, output: 5, total: 15 },
      errors: [{ node: 'b', message: 'warn', at: '2026-06-25T00:01:00Z' }],
      round: 2,
      researcherCount: 2,
      finalReport: 'REPORT',
      finalizeReason: 'completed',
      messages: [new AIMessage('from b')],
    });

    const graph = new StateGraph(DeepResearchStateAnnotation)
      .addNode('a', a)
      .addNode('b', b)
      .addEdge(START, 'a')
      .addEdge('a', 'b')
      .addEdge('b', END)
      .compile();

    const result: DeepResearchState = await graph.invoke({
      messages: [new HumanMessage('user q')],
    });

    expect(result.jurisdiction).toBe('KZ');
    expect(result.findings.map((f) => f.digest)).toEqual(['d1', 'd2']);
    expect(result.errors).toHaveLength(2);
    expect(result.tokenUsage).toEqual({ input: 110, output: 55, total: 165 });
    expect(result.round).toBe(2);
    expect(result.researcherCount).toBe(2);
    expect(result.finalReport).toBe('REPORT');
    expect(result.finalizeReason).toBe('completed');
    expect(result.messages).toHaveLength(3);
  });

  it('applies channel defaults when nodes write nothing', async () => {
    const graph = new StateGraph(DeepResearchStateAnnotation)
      .addNode('noop', (): DeepResearchStateUpdate => ({}))
      .addEdge(START, 'noop')
      .addEdge('noop', END)
      .compile();

    const result: DeepResearchState = await graph.invoke({ messages: [] });

    expect(result.jurisdiction).toBe('');
    expect(result.researchBrief).toBe('');
    expect(result.currentSubQuestion).toBe('');
    expect(result.findings).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.tokenUsage).toEqual({ input: 0, output: 0, total: 0 });
    expect(result.round).toBe(0);
    expect(result.researcherCount).toBe(0);
    expect(result.finalReport).toBe('');
    expect(result.finalizeReason).toBeNull();
  });
});
