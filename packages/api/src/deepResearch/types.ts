import type { DeepResearchMode } from 'librechat-data-provider';

/** A Deep Research mode resolved from config + defaults into concrete values. */
export interface ResolvedDeepResearchMode {
  name: DeepResearchMode;
  /** Soft guidance for how many research tasks the orchestrator dispatches. */
  maxConcurrentResearchers: number;
  /** Soft cap on orchestrator gather→reflect→dispatch rounds. */
  maxOrchestratorCycles: number;
  /** Hard per-researcher AGENT→TOOLS cycle cap (SubagentConfig.maxTurns). */
  maxSearcherTurns: number;
  /** Advisory token ceiling for one run (surfaced for budgeting/telemetry). */
  perRunTokenBudget: number;
  /** Advisory wall-clock ceiling in minutes. */
  wallClockMinutes: number;
  /** Orchestrator/writer model; falls back to the conversation model when unset. */
  leadModel?: string;
  /** Researcher (worker) model; falls back to the conversation model when unset. */
  workerModel?: string;
  /** Optional dedicated writer model; reserved for later phases. */
  writerModel?: string;
}
