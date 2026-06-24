/**
 * Per-run budget enforcement for Deep Research.
 *
 * A DR mode declares `wallClockMinutes` and `perRunTokenBudget`. Without this
 * watchdog those were display-only — nothing aborted a run that ran too long or
 * spent too much (only the orchestrator step `recursion_limit` bounded it). This
 * arms a wall-clock timeout and a token-budget poll on the run's AbortController;
 * an overrun aborts the run GRACEFULLY (the agents client persists the partial
 * report with `unfinished: true`, it is not a hard error).
 */

/** Minimal view of a usage record — we read only token counts (decoupled). */
export interface DeepResearchUsageRecord {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

export interface DeepResearchBudget {
  /** Hard wall-clock cap in ms; <= 0 disables the wall-clock watchdog. */
  wallClockMs: number;
  /** Hard prompt+completion token cap; <= 0 disables the token watchdog. */
  tokenBudget: number;
}

export interface BudgetWatchdogParams {
  abortController: AbortController;
  /** Live array the run appends usage to (primary + every subagent). */
  collectedUsage: DeepResearchUsageRecord[];
  budget: DeepResearchBudget;
  logger?: { warn?: (message: string) => void };
}

/** Poll cadence for the token-budget watchdog. Overshoot is bounded by one LLM
 *  call's usage between ticks — fine for a safety cap, cheap on the event loop. */
const TOKEN_POLL_MS = 2000;

/** Sums prompt+completion tokens across all collected usage records. */
export function sumUsageTokens(usage: DeepResearchUsageRecord[]): number {
  let total = 0;
  for (const u of usage ?? []) {
    total += u?.total_tokens ?? (u?.input_tokens ?? 0) + (u?.output_tokens ?? 0);
  }
  return total;
}

/**
 * Arms the wall-clock + token-budget watchdogs. Returns a disposer that MUST be
 * called in a `finally` to clear both timers on every exit path (success, error,
 * abort, client disconnect) — otherwise a stale timer could abort a later run or
 * leak. Timers are `unref`-ed so they never keep the process alive.
 */
export function armDeepResearchBudget({
  abortController,
  collectedUsage,
  budget,
  logger,
}: BudgetWatchdogParams): () => void {
  const disposers: Array<() => void> = [];

  const abort = (reason: string): void => {
    if (abortController.signal.aborted) {
      return;
    }
    logger?.warn?.(`[deepResearch] ${reason}; aborting run (partial report preserved)`);
    abortController.abort();
  };

  if (budget.wallClockMs > 0) {
    const timer = setTimeout(
      () => abort(`wall-clock budget ${Math.round(budget.wallClockMs / 1000)}s exceeded`),
      budget.wallClockMs,
    );
    timer.unref?.();
    disposers.push(() => clearTimeout(timer));
  }

  if (budget.tokenBudget > 0) {
    const interval = setInterval(() => {
      const used = sumUsageTokens(collectedUsage);
      if (used > budget.tokenBudget) {
        abort(`token budget ${budget.tokenBudget} exceeded (used ${used})`);
      }
    }, TOKEN_POLL_MS);
    interval.unref?.();
    disposers.push(() => clearInterval(interval));
  }

  return () => {
    for (const dispose of disposers) {
      dispose();
    }
  };
}
