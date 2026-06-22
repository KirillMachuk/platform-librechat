import { resolveDeepResearchMode, DEEP_RESEARCH_MODE_DEFAULTS } from './modes';
import { buildSearcherAgent, buildDeepResearchGraph } from './graph';
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
    expect(
      resolveDeepResearchMode({ activeMode: 'nonsense' as unknown as 'deep' }),
    ).toEqual(DEEP_RESEARCH_MODE_DEFAULTS.deep);
  });

  it('merges per-mode overrides over the preset and carries model ids', () => {
    const resolved = resolveDeepResearchMode({
      activeMode: 'deep',
      modes: {
        deep: { maxConcurrentResearchers: 6, leadModel: 'lead-x', workerModel: 'worker-y' },
      },
    });
    expect(resolved.maxConcurrentResearchers).toBe(6);
    expect(resolved.maxOrchestratorCycles).toBe(DEEP_RESEARCH_MODE_DEFAULTS.deep.maxOrchestratorCycles);
    expect(resolved.leadModel).toBe('lead-x');
    expect(resolved.workerModel).toBe('worker-y');
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

  it('derives a distinct ephemeral id and the unified retrieval toolset', () => {
    const searcher = buildSearcherAgent(primary, DEEP_RESEARCH_MODE_DEFAULTS.deep, 'NOW');
    expect(searcher.id).toBe('ephemeral__dr_searcher');
    expect(searcher.id).not.toBe(primary.id);
    expect(searcher.id?.startsWith('agent_')).toBe(false);
    expect(searcher.tools).toEqual(['web_search', 'file_search']);
    expect(typeof searcher.instructions).toBe('string');
    expect((searcher.instructions ?? '').length).toBeGreaterThan(100);
  });

  it('uses the worker model when set, else inherits the primary model', () => {
    const withWorker = buildSearcherAgent(
      primary,
      { ...DEEP_RESEARCH_MODE_DEFAULTS.deep, workerModel: 'worker-model' },
      'NOW',
    );
    expect(withWorker.model).toBe('worker-model');
    const withoutWorker = buildSearcherAgent(primary, DEEP_RESEARCH_MODE_DEFAULTS.deep, 'NOW');
    expect(withoutWorker.model).toBe('lead-model');
  });

  it('deep-clones tool_resources so the searcher cannot mutate the parent', () => {
    const searcher = buildSearcherAgent(primary, DEEP_RESEARCH_MODE_DEFAULTS.deep, 'NOW');
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
    agent: { id: 'ephemeral', model: 'lead-model', tool_resources: { file_search: { file_ids: [] } } },
    config: { id: 'ephemeral', instructions: 'Workspace instructions.' },
  });

  it('attaches the researcher subagent and rewrites the orchestrator instructions', async () => {
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
    expect(config.instructions).toContain('оркестратор');
    expect(config.instructions).toContain('Workspace instructions.');
  });

  it('falls back gracefully (no subagents) when the researcher fails to initialize', async () => {
    const { agent, config } = makePrimary();
    const warn = jest.fn();
    const ok = await buildDeepResearchGraph({
      primaryAgent: agent,
      primaryConfig: config,
      mode: DEEP_RESEARCH_MODE_DEFAULTS.deep,
      initializeSearcher: async () => null,
      logger: { warn },
    });

    expect(ok).toBe(false);
    expect(config.subagents).toBeUndefined();
    expect(config.subagentAgentConfigs).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
