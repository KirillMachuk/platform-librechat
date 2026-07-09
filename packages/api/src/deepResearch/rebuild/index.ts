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
export { sanitizeErrorForUser, usageFromExchange } from './shared';
export { startSovereignSession, sovereignPassthroughHeaders } from './sovereign';
export { reportToPdfBuffer } from './pdf';
export {
  buildClarifyPrompt,
  parseClarifyOutput,
  formatClarifyMessage,
  isClarifyMessage,
} from './clarify';
export {
  PLAN_MARKER,
  START_MARKER,
  CANCEL_MARKER,
  CANCELLED_MESSAGE,
  isPlanMessage,
  buildPlanPrompt,
  isStartCommand,
  extractPlanSteps,
  isCancelCommand,
  formatPlanMessage,
  parsePlanDecision,
} from './plan';
export {
  tierToRunBudget,
  leadModelFor,
  workerModelFor,
  reportModelFor,
  compressModelFor,
  resolveDeepResearchTier,
} from './config';

export type { DeepResearchTier } from './config';
export type { PlanAction, PlanDecision } from './plan';
export type { AnonymizerConnection, SovereignSession } from './sovereign';
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
