import { Annotation, messagesStateReducer } from '@langchain/langgraph';
import type { BaseMessage } from '@langchain/core/messages';
import type { DeepResearchMode } from 'librechat-data-provider';

/**
 * Deep Research graph state (custom StateGraph rebuild).
 *
 * Design constraints (see DR_Rebuild_Plan.md §3):
 * - Lightweight: a reducer is declared ONLY where a channel must accumulate
 *   across nodes/supersteps; every other channel is last-value-wins.
 * - Raw research never enters this outer state — researchers COMPRESS to a
 *   bounded digest before returning, so `messages` cannot balloon under fan-out.
 * - Per-request facts (ids, budget, mode) ride on `config.configurable`, never
 *   on module-level mutable state, so one compiled graph is reused for all runs.
 */

/** One compressed researcher result. The raw tool output stays inside the
 *  researcher and is discarded; only this bounded digest reaches outer state. */
export interface DeepResearchFinding {
  /** Orchestrator round that produced this finding. */
  round: number;
  /** The sub-question the researcher was dispatched to answer. */
  subQuestion: string;
  /** Bounded digest (≤ the tier's digest cap), ready for synthesis. */
  digest: string;
  /** Source identifiers/URLs backing the digest (for ГОСТ citations). */
  sources: string[];
  /** Tokens this finding cost (prompt+completion) — feeds budgeting/telemetry. */
  tokens: number;
}

/** A non-fatal node failure. Nodes NEVER throw; they append one of these and
 *  return a sentinel so a sibling's failure can't collapse the whole superstep. */
export interface DeepResearchNodeError {
  node: string;
  message: string;
  /** ISO timestamp; passed in (never `Date.now()` inside a graph node). */
  at: string;
}

/** Why the run finalized — a single REPORT path serves full and partial reports.
 *  'rounds' = the orchestrator round cap stopped gathering (a deliberate partial,
 *  distinct from 'completed' so the UI can say so). 'limit' = the run was refused
 *  up front (per-user concurrency cap) and never gathered — a terminal, NON-error
 *  state the UI must not flag as an unfinished/failed message. */
export type FinalizeReason =
  | 'completed'
  | 'budget'
  | 'rounds'
  | 'time'
  | 'aborted'
  | 'error'
  | 'limit';

/** Why SUPERVISOR ended the gather loop; REPORT maps it to a FinalizeReason. */
export type SupervisorConcludeReason = 'budget' | 'rounds' | 'complete';

/** Prompt+completion token accounting, summed across every model call. */
export interface DeepResearchTokenUsage {
  input: number;
  output: number;
  total: number;
}

/**
 * Per-run values carried on `config.configurable` (NOT in graph state).
 * The AbortSignal rides on `config.signal`, not here.
 */
export interface DeepResearchConfigurable {
  runId: string;
  userId: string;
  tenantId?: string;
  conversationId?: string;
  /** Active depth tier; selects models/limits from the tier config. */
  mode: DeepResearchMode;
  budget: DeepResearchRunBudget;
}

export interface DeepResearchRunBudget {
  /** Hard wall-clock cap (ms); <= 0 disables the wall-clock watchdog. */
  wallClockMs: number;
  /** Hard prompt+completion token cap for the whole run. */
  tokenBudget: number;
  /**
   * Fraction of `tokenBudget` at which the supervisor stops dispatching new
   * research and routes to REPORT, reserving the remainder for synthesis
   * (e.g. 0.7 → gather until 70% spent, keep 30% for writing the report).
   */
  budgetGateRatio: number;
}

const lastWins = <T>(_current: T, incoming: T): T => incoming;
const concat = <T>(current: T[], incoming: T[] | undefined): T[] => current.concat(incoming ?? []);
const sumUsage = (
  current: DeepResearchTokenUsage,
  incoming: Partial<DeepResearchTokenUsage> | undefined,
): DeepResearchTokenUsage => ({
  input: current.input + (incoming?.input ?? 0),
  output: current.output + (incoming?.output ?? 0),
  total: current.total + (incoming?.total ?? 0),
});

/**
 * The graph state schema. `Annotation.Root` is a literal here (the SDK's closed
 * `{messages, agentMessages}` is exactly what we needed to escape — these custom
 * channels are the whole reason for the StateGraph rebuild; see §0.A).
 */
export const DeepResearchStateAnnotation = Annotation.Root({
  /** User-facing conversation: input messages + the streamed final report. */
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  /** Target jurisdiction (RU/RB/KZ). Mandatory — SCOPE sets it; never defaulted. */
  jurisdiction: Annotation<string>({ reducer: lastWins, default: () => '' }),
  /** Research brief produced by SCOPE from the user's request. */
  researchBrief: Annotation<string>({ reducer: lastWins, default: () => '' }),
  /** Sub-question the supervisor hands to the next researcher dispatch. */
  currentSubQuestion: Annotation<string>({ reducer: lastWins, default: () => '' }),
  /** Compressed digests — the only research that reaches outer state. */
  findings: Annotation<DeepResearchFinding[]>({ reducer: concat, default: () => [] }),
  /** Completed orchestrator rounds (written only by SUPERVISOR). */
  round: Annotation<number>({ reducer: lastWins, default: () => 0 }),
  /** Researchers dispatched so far (written only by SUPERVISOR; caps spawns). */
  researcherCount: Annotation<number>({ reducer: lastWins, default: () => 0 }),
  /** Set by SUPERVISOR when the gather loop ends; the routing edge reads it. */
  concludeReason: Annotation<SupervisorConcludeReason | null>({
    reducer: lastWins,
    default: () => null,
  }),
  /** Running token spend across every model call (nodes return a partial delta). */
  tokenUsage: Annotation<DeepResearchTokenUsage, Partial<DeepResearchTokenUsage>>({
    reducer: sumUsage,
    default: () => ({ input: 0, output: 0, total: 0 }),
  }),
  /** Accumulated non-fatal node errors (sentinel channel). */
  errors: Annotation<DeepResearchNodeError[]>({ reducer: concat, default: () => [] }),
  /** The composed report (written only by the terminal REPORT node). */
  finalReport: Annotation<string>({ reducer: lastWins, default: () => '' }),
  /** Why the run ended; null until REPORT runs. */
  finalizeReason: Annotation<FinalizeReason | null>({
    reducer: lastWins,
    default: () => null,
  }),
});

/** Full materialized state. */
export type DeepResearchState = typeof DeepResearchStateAnnotation.State;
/** A partial update returned by a node. */
export type DeepResearchStateUpdate = typeof DeepResearchStateAnnotation.Update;
