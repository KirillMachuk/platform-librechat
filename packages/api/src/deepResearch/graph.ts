import { replaceSpecialVars } from 'librechat-data-provider';
import { buildWebSearchContext } from '../tools/toolkits/web';
import { buildOrchestratorInstructions, buildSearcherInstructions } from './prompts';
import type { ResolvedDeepResearchMode } from './types';

/**
 * Minimal structural view of an agent definition / initialized run config that
 * Deep Research reads or mutates. The full shapes live in `/api` (JS) and the
 * agents SDK; we depend only on the fields we touch to keep this module decoupled.
 */
export interface DeepResearchAgent {
  id?: string;
  name?: string;
  description?: string;
  model?: string;
  provider?: string;
  endpoint?: string;
  instructions?: string;
  tools?: string[];
  tool_resources?: Record<string, unknown>;
}

export interface DeepResearchConfig extends DeepResearchAgent {
  subagents?: { enabled?: boolean; allowSelf?: boolean };
  subagentAgentConfigs?: DeepResearchConfig[];
  maxTurns?: number;
}

export interface BuildDeepResearchGraphParams {
  /** The ephemeral primary agent definition (source of model/provider/tool_resources). */
  primaryAgent: DeepResearchAgent;
  /** The initialized primary config to mutate into the orchestrator. */
  primaryConfig: DeepResearchConfig;
  mode: ResolvedDeepResearchMode;
  /**
   * Initializes a synthetic searcher agent into a run config and registers its
   * tool-execution context. Provided by the caller (initialize.js), closing over
   * the agents initializer + request deps. Returns null on failure so the run can
   * gracefully fall back to a single agent.
   */
  initializeSearcher: (agent: DeepResearchAgent) => Promise<DeepResearchConfig | null>;
  logger?: { warn: (message: string, meta?: unknown) => void };
}

const SEARCHER_SUFFIX = '__dr_searcher';
const SEARCHER_DISPLAY_NAME = 'Researcher';

/** Deep-clones file/tool resources so a searcher's file_ids are independent of the parent. */
function cloneToolResources(
  resources: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!resources) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(resources)) as Record<string, unknown>;
}

/** Builds the synthetic researcher agent definition for the unified-retrieval workers. */
export function buildSearcherAgent(
  primaryAgent: DeepResearchAgent,
  mode: ResolvedDeepResearchMode,
  now: string,
): DeepResearchAgent {
  return {
    id: `${primaryAgent.id ?? 'ephemeral'}${SEARCHER_SUFFIX}`,
    name: SEARCHER_DISPLAY_NAME,
    description:
      'Запускает агента-исследователя в изолированном контексте для одного подвопроса; ' +
      'ищет в интернете (web_search) и во внутренних документах (file_search), возвращает отчёт.',
    model: mode.workerModel ?? primaryAgent.model,
    provider: primaryAgent.provider,
    endpoint: primaryAgent.endpoint,
    instructions: buildSearcherInstructions({ now, maxCycles: mode.maxSearcherTurns }),
    tools: ['web_search', 'file_search'],
    tool_resources: cloneToolResources(primaryAgent.tool_resources),
  };
}

/** Prepends orchestrator instructions while preserving any workspace instructions. */
function composeInstructions(orchestrator: string, existing?: string): string {
  const base = (existing ?? '').trim();
  if (!base) {
    return orchestrator;
  }
  return `${orchestrator}\n\n---\nДополнительный контекст рабочего пространства:\n${base}`;
}

/**
 * Turns the primary ephemeral agent into a Deep Research orchestrator: builds a
 * single researcher subagent (spawned per sub-question in isolated context),
 * sets its per-loop cap, and attaches it as the primary's spawn target. The
 * primary runs as a standard graph whose orchestrator prompt drives plan →
 * dispatch → reflect → write. Returns false if the searcher could not be built.
 */
export async function buildDeepResearchGraph(
  params: BuildDeepResearchGraphParams,
): Promise<boolean> {
  const { primaryAgent, primaryConfig, mode, initializeSearcher, logger } = params;
  const now = replaceSpecialVars({ text: '{{iso_datetime}}' });
  const citationContext = buildWebSearchContext();

  const searcherAgent = buildSearcherAgent(primaryAgent, mode, now);
  const searcherConfig = await initializeSearcher(searcherAgent);
  if (!searcherConfig) {
    logger?.warn?.(
      '[deepResearch] researcher initialization failed; running as a single agent without research subagents',
    );
    return false;
  }

  searcherConfig.maxTurns = mode.maxSearcherTurns;

  primaryConfig.instructions = composeInstructions(
    buildOrchestratorInstructions({
      now,
      citationContext,
      maxResearchers: mode.maxConcurrentResearchers,
      maxCycles: mode.maxOrchestratorCycles,
      searcherName: SEARCHER_DISPLAY_NAME,
    }),
    primaryConfig.instructions,
  );
  primaryConfig.subagents = { enabled: true, allowSelf: false };
  primaryConfig.subagentAgentConfigs = [searcherConfig];
  return true;
}
