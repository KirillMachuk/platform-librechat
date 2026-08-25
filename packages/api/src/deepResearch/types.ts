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
  /** Fraction of `perRunTokenBudget` at which gathering stops, reserving the rest for REPORT. */
  budgetGateRatio: number;
  /** Wall-clock analogue of `budgetGateRatio`. */
  timeGateRatio: number;
  /** Max characters of one researcher's digest — the report's factual base. */
  digestCap: number;
  /** Max characters of raw tool output fed into COMPRESS per researcher. */
  compressInputChars: number;
  /** How many recent turns keep raw tool results in the researcher's context. 0 = no clearing. */
  toolResultWindow: number;
  /** Orchestrator/writer model; falls back to the conversation model when unset. */
  leadModel?: string;
  /** Researcher (worker) model; falls back to the conversation model when unset. */
  workerModel?: string;
  /** Optional dedicated writer model; reserved for later phases. */
  writerModel?: string;
  /**
   * OpenRouter provider routing for this tier's model calls. Undefined = unpinned,
   * which is what every tier did before this existed.
   */
  provider?: { order: string[]; allow_fallbacks?: boolean };
}
