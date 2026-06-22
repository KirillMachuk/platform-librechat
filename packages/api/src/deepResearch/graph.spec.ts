import { resolveDeepResearchMode, DEEP_RESEARCH_MODE_DEFAULTS } from './modes';
import { buildSearcherAgent, buildDeepResearchGraph, deepResearchRecursionLimit } from './graph';
import type { DeepResearchAgent, DeepResearchConfig } from './graph';

describe('resolveDeepResearchMode', () => {
  it('defaults to the deep preset when no config is provided', () => {
    expect(resolveDeepResearchMode()).toEqual(DEEP_RESEARCH_MODE_DEFAULTS.deep);
  });

  it('selects the active mode preset', () => {
    expect(resolveDeepResearchMode({ activeMode: 'economy' })).toEqual(
      DEEP_RESEARCH_MODE_DEFAULTS.economy,
    );
  });

  it('falls back to deep for an unknown active mode', () => {
    expect(resolveDeepResearchMode({ activeMode: 'nonsense' as unknown as 'deep' })).toEqual(
      DEEP_RESEARCH_MODE_DEFAULTS.deep,
    );
  });

  it('merges per-mode overrides over the preset and carries model ids', () => {
    const resolved = resolveDeepResearchMode({
      activeMode: 'deep',
      modes: {
        deep: { maxConcurrentResearchers: 6, leadModel: 'lead-x', workerModel: 'worker-y' },
      },
    });
    expect(resolved.maxConcurrentResearchers).toBe(6);
    expect(resolved.maxOrchestratorCycles).toBe(
      DEEP_RESEARCH_MODE_DEFAULTS.deep.maxOrchestratorCycles,
    );
    expect(resolved.leadModel).toBe('lead-x');
    expect(resolved.workerModel).toBe('worker-y');
  });
});

describe('deepResearchRecursionLimit', () => {
  it('derives a bounded per-run step cap from the mode', () => {
    const deep = deepResearchRecursionLimit(DEEP_RESEARCH_MODE_DEFAULTS.deep);
    expect(deep).toBe((8 + 4) * 2 + 6); // 30
    expect(deep).toBeLessThanOrEqual(50);
    expect(deepResearchRecursionLimit(DEEP_RESEARCH_MODE_DEFAULTS.economy)).toBeGreaterThanOrEqual(
      12,
    );
  });
});

describe('buildSearcherAgent', () => {
  const primary: DeepResearchAgent = {
    id: 'ephemeral',
    model: 'lead-model',
    provider: 'openrouter',
    endpoint: 'openrouter',
    tool_resources: { file_search: { file_ids: ['f1', 'f2'] } },
  };
  const opts = { now: 'NOW', webSearchAvailable: true };

  it('derives a distinct ephemeral id and the unified retrieval toolset', () => {
    const searcher = buildSearcherAgent(primary, DEEP_RESEARCH_MODE_DEFAULTS.deep, opts);
    expect(searcher.id).toBe('ephemeral__dr_searcher');
    expect(searcher.id).not.toBe(primary.id);
    expect(searcher.id?.startsWith('agent_')).toBe(false);
    expect(searcher.tools).toEqual(['web_search', 'file_search']);
    expect((searcher.instructions ?? '').length).toBeGreaterThan(100);
  });

  it('is RAG-only when web search is unavailable (no foreign egress)', () => {
    const searcher = buildSearcherAgent(primary, DEEP_RESEARCH_MODE_DEFAULTS.deep, {
      now: 'NOW',
      webSearchAvailable: false,
    });
    expect(searcher.tools).toEqual(['file_search']);
  });

  it('uses workerModel, else the conversation model — never the (overridden) lead model', () => {
    const withWorker = buildSearcherAgent(
      primary,
      { ...DEEP_RESEARCH_MODE_DEFAULTS.deep, workerModel: 'worker-model' },
      { ...opts, conversationModel: 'convo-model' },
    );
    expect(withWorker.model).toBe('worker-model');

    // No workerModel: must fall back to the captured conversation model, NOT primary.model
    // (which may have been overridden to the expensive lead model).
    const noWorker = buildSearcherAgent(
      { ...primary, model: 'lead-OVERRIDDEN' },
      DEEP_RESEARCH_MODE_DEFAULTS.deep,
      {
        ...opts,
        conversationModel: 'convo-model',
      },
    );
    expect(noWorker.model).toBe('convo-model');
  });

  it('deep-clones tool_resources so the searcher cannot mutate the parent', () => {
    const searcher = buildSearcherAgent(primary, DEEP_RESEARCH_MODE_DEFAULTS.deep, opts);
    expect(searcher.tool_resources).toEqual(primary.tool_resources);
    expect(searcher.tool_resources).not.toBe(primary.tool_resources);
    (searcher.tool_resources?.file_search as { file_ids: string[] }).file_ids.push('mutated');
    expect((primary.tool_resources?.file_search as { file_ids: string[] }).file_ids).toEqual([
      'f1',
      'f2',
    ]);
  });
});

describe('buildDeepResearchGraph', () => {
  const makePrimary = (): { agent: DeepResearchAgent; config: DeepResearchConfig } => ({
    agent: {
      id: 'ephemeral',
      model: 'lead-model',
      tool_resources: { file_search: { file_ids: [] } },
    },
    config: { id: 'ephemeral', instructions: 'Workspace instructions.' },
  });

  it('attaches the researcher subagent, caps recursion, and rewrites instructions', async () => {
    const { agent, config } = makePrimary();
    let receivedSearcher: DeepResearchAgent | null = null;
    const initializeSearcher = jest.fn(async (searcher: DeepResearchAgent) => {
      receivedSearcher = searcher;
      return { id: searcher.id, model: searcher.model } as DeepResearchConfig;
    });

    const ok = await buildDeepResearchGraph({
      primaryAgent: agent,
      primaryConfig: config,
      mode: DEEP_RESEARCH_MODE_DEFAULTS.deep,
      conversationModel: 'convo-model',
      webSearchAvailable: true,
      initializeSearcher,
    });

    expect(ok).toBe(true);
    expect(initializeSearcher).toHaveBeenCalledTimes(1);
    expect(receivedSearcher!.id).toBe('ephemeral__dr_searcher');
    expect(config.subagents).toEqual({ enabled: true, allowSelf: false });
    expect(config.subagentAgentConfigs).toHaveLength(1);
    expect(config.subagentAgentConfigs![0].maxTurns).toBe(
      DEEP_RESEARCH_MODE_DEFAULTS.deep.maxSearcherTurns,
    );
    expect(config.recursion_limit).toBe(
      deepResearchRecursionLimit(DEEP_RESEARCH_MODE_DEFAULTS.deep),
    );
    expect(config.instructions).toContain('оркестратор');
    expect(config.instructions).toContain('Workspace instructions.');
  });

  it('falls back gracefully (no subagents, no recursion override) when the researcher fails', async () => {
    const { agent, config } = makePrimary();
    const warn = jest.fn();
    const ok = await buildDeepResearchGraph({
      primaryAgent: agent,
      primaryConfig: config,
      mode: DEEP_RESEARCH_MODE_DEFAULTS.deep,
      webSearchAvailable: true,
      initializeSearcher: async () => null,
      logger: { warn },
    });

    expect(ok).toBe(false);
    expect(config.subagents).toBeUndefined();
    expect(config.subagentAgentConfigs).toBeUndefined();
    expect(config.recursion_limit).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
