import { replaceSpecialVars } from 'librechat-data-provider';
import type { ResolvedDeepResearchMode } from './types';
import { buildOrchestratorInstructions, buildSearcherInstructions } from './prompts';
import { isReasoningModel, resolveDeepResearchModel } from './modes';
import { buildWebSearchContext } from '../tools/toolkits/web';

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
  /** Per-run orchestrator step cap (honored by resolveRecursionLimit) — bounds spawns/cost. */
  recursion_limit?: number;
  /**
   * Per-run wall-clock and token caps, enforced in the agents client run loop
   * (a watchdog aborts the run gracefully — partial report is preserved). Set
   * from the active mode so `wallClockMinutes`/`perRunTokenBudget` are real
   * limits, not display-only config.
   */
  deepResearchBudget?: { wallClockMs: number; tokenBudget: number };
}

export interface BuildDeepResearchGraphParams {
  /** The ephemeral primary agent definition (source of model/provider/tool_resources). */
  primaryAgent: DeepResearchAgent;
  /** The initialized primary config to mutate into the orchestrator. */
  primaryConfig: DeepResearchConfig;
  mode: ResolvedDeepResearchMode;
  /**
   * The conversation's originally-selected model, captured BEFORE the lead-model
   * override. A non-reasoning fallback for the researcher when `workerModel` is
   * unset; reasoning models are skipped (they 400 on multi-turn tool calls).
   */
  conversationModel?: string;
  /** Whether web search is configured; when false, DR runs RAG-only (sovereign). */
  webSearchAvailable: boolean;
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

/**
 * Per-run orchestrator step ceiling (honored by `resolveRecursionLimit` via
 * `recursion_limit`). Bounds the number of researcher spawns + reflections so
 * cost is structurally capped per mode rather than relying on the prompt alone.
 */
export function deepResearchRecursionLimit(mode: ResolvedDeepResearchMode): number {
  const limit = (mode.maxOrchestratorCycles + mode.maxConcurrentResearchers) * 2 + 6;
  return Math.min(50, Math.max(12, limit));
}

export interface SearcherAgentOptions {
  now: string;
  /** Non-reasoning researcher fallback when `mode.workerModel` is unset. */
  conversationModel?: string;
  /** When false, the researcher gets file_search only (no foreign web egress). */
  webSearchAvailable: boolean;
}

/** Builds the synthetic researcher agent definition for the unified-retrieval workers. */
export function buildSearcherAgent(
  primaryAgent: DeepResearchAgent,
  mode: ResolvedDeepResearchMode,
  options: SearcherAgentOptions,
): DeepResearchAgent {
  const { now, conversationModel, webSearchAvailable } = options;
  const tools = webSearchAvailable ? ['web_search', 'file_search'] : ['file_search'];
  return {
    id: `${primaryAgent.id ?? 'ephemeral'}${SEARCHER_SUFFIX}`,
    name: SEARCHER_DISPLAY_NAME,
    description:
      'Запускает агента-исследователя в изолированном контексте для одного подвопроса; ' +
      'ищет во внутренних документах (file_search)' +
      (webSearchAvailable ? ' и в интернете (web_search)' : '') +
      ', возвращает структурированный отчёт.',
    model: resolveDeepResearchModel(mode.workerModel, conversationModel, primaryAgent.model),
    /**
     * Resolve the worker against the primary's ENDPOINT identity, not its
     * `provider`. By the time the graph is assembled, the primary's
     * `initializeAgent` has already replaced `primaryAgent.provider` with the
     * resolved SDK provider — custom endpoints collapse to `openAI` via
     * `getProviderConfig`'s `overrideProvider`. Reusing that collapsed value
     * makes the searcher's own `initializeAgent` resolve the DEFAULT OpenAI
     * endpoint instead of the custom one, sending the configured worker model
     * to the wrong upstream (`400 invalid model ID`) and bypassing any
     * sovereign egress proxy. `endpoint` preserves the original identity the
     * primary used to resolve its config, so the worker routes identically.
     */
    provider: primaryAgent.endpoint ?? primaryAgent.provider,
    endpoint: primaryAgent.endpoint,
    instructions: buildSearcherInstructions({
      now,
      maxCycles: mode.maxSearcherTurns,
      webSearchAvailable,
    }),
    tools,
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
 * dispatch → reflect → write, bounded by a per-run recursion limit. Returns
 * false if the searcher could not be built (graceful single-agent fallback).
 */
export async function buildDeepResearchGraph(
  params: BuildDeepResearchGraphParams,
): Promise<boolean> {
  const {
    primaryAgent,
    primaryConfig,
    mode,
    conversationModel,
    webSearchAvailable,
    initializeSearcher,
    logger,
  } = params;
  const now = replaceSpecialVars({ text: '{{iso_datetime}}' });
  const citationContext = buildWebSearchContext();

  const searcherAgent = buildSearcherAgent(primaryAgent, mode, {
    now,
    conversationModel,
    webSearchAvailable,
  });
  if (isReasoningModel(searcherAgent.model)) {
    logger?.warn?.(
      `[deepResearch] Researcher model "${searcherAgent.model}" is a reasoning model that may 400 on multi-turn tool calls; set deepResearch.modes.${mode.name}.workerModel to a non-reasoning model.`,
    );
  }
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
      webSearchAvailable,
    }),
    primaryConfig.instructions,
  );
  primaryConfig.subagents = { enabled: true, allowSelf: false };
  primaryConfig.subagentAgentConfigs = [searcherConfig];
  primaryConfig.recursion_limit = deepResearchRecursionLimit(mode);
  primaryConfig.deepResearchBudget = {
    wallClockMs: Math.max(1, mode.wallClockMinutes) * 60_000,
    tokenBudget: mode.perRunTokenBudget,
  };
  return true;
}
