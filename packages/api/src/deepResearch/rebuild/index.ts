/**
 * Public API of the Deep Research rebuild (custom LangGraph.js StateGraph engine).
 * The host (`/api`) imports these via `@librechat/api` to run DR behind a flag.
 * The lower-level `buildDeepResearchGraph` is intentionally NOT re-exported here
 * (it collides by name with the old DR and is only needed internally/by tests).
 */
export { createDeepResearchGraph } from './graph';
export { runDeepResearch } from './run';
export { selectChatFileSearchInputs } from './files';
export { buildFallbackReport } from './nodes/report';
export { sanitizeErrorForUser } from './shared';
export {
  tierToRunBudget,
  leadModelFor,
  workerModelFor,
  reportModelFor,
  compressModelFor,
  resolveDeepResearchTier,
} from './config';

export type { DeepResearchTier } from './config';
export type { CompiledDeepResearchGraph, DeepResearchGraphDeps } from './graph';
export type { DeepResearchProgress, RunDeepResearchParams, RunDeepResearchResult } from './run';
export type {
  FinalizeReason,
  DeepResearchState,
  DeepResearchFinding,
  DeepResearchRunBudget,
  DeepResearchTokenUsage,
  DeepResearchConfigurable,
} from './state';
