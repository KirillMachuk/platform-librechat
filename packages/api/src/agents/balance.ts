import { ViolationTypes } from 'librechat-data-provider';
import type { UsageMetadata } from '~/stream/interfaces/IJobStore';
import type { EndpointTokenConfig } from '~/types/tokens';
import type { PricingFns } from './transactions';
import { computeUsageCostUSD } from './usage';

/** Credits are USD × 1e6 (the unit stored on `balance.tokenCredits`). */
const CREDITS_PER_USD = 1e6;

/** Minimal balance record shape read by the per-turn guard. */
export interface TurnBalanceRecord {
  tokenCredits: number;
}

/**
 * Error payload matching the `token_balance` shape the client renders
 * (`client/src/components/Messages/Content/Error.tsx`) and the one
 * `checkBalance` throws, so the recheck reuses the exact existing pattern.
 */
export interface TokenBalanceViolation {
  type: string;
  balance: number;
  tokenCost: number;
  promptTokens: number;
}

export interface EvaluateAgentTurnBalanceParams {
  user: string;
  /**
   * Live reference to the run's collected usage (primary + subagent +
   * summarization). Read at evaluation time so the in-flight spend of the
   * current message is accounted for — mid-run balance is NOT yet debited
   * (billing is batched in the run's `finally`), so a plain stored-balance
   * read would miss single-message overspend.
   */
  collectedUsage: ReadonlyArray<UsageMetadata>;
  findBalanceByUser: (user: string) => Promise<TurnBalanceRecord | null>;
  pricing: PricingFns;
  /** Stop when `balance - spent <= bufferCredits`. Default 0 (stop at/under zero). */
  bufferCredits?: number;
  endpointTokenConfig?: EndpointTokenConfig;
  resolveEndpointTokenConfig?: (usage: UsageMetadata) => EndpointTokenConfig | undefined;
}

export interface AgentTurnBalanceResult {
  exhausted: boolean;
  balanceCredits: number;
  spentCredits: number;
  errorMessage?: TokenBalanceViolation;
}

/**
 * Prices the run's in-flight usage with the SAME authoritative pricing the
 * final bill uses (`computeUsageCostUSD`) and compares it against the user's
 * current stored balance. Read-only: performs no spend and no balance write.
 *
 * A single unpriceable usage entry is skipped rather than aborting the whole
 * check — the guard is a best-effort safety net on top of the pre-request
 * check and the authoritative post-run billing, not a substitute for either.
 */
export async function evaluateAgentTurnBalance(
  params: EvaluateAgentTurnBalanceParams,
): Promise<AgentTurnBalanceResult> {
  /**
   * Fail open on a blank user id. `findBalanceByUser('')` / `undefined` would let
   * Mongoose strip the filter and match an arbitrary balance document, so a
   * missing id must never gate the run — return not-exhausted without a read.
   */
  if (!params.user) {
    return { exhausted: false, balanceCredits: 0, spentCredits: 0 };
  }

  const record = await params.findBalanceByUser(params.user);
  const balanceCredits = record?.tokenCredits ?? 0;

  let spentUSD = 0;
  for (const usage of params.collectedUsage) {
    const endpointTokenConfig =
      params.resolveEndpointTokenConfig?.(usage) ?? params.endpointTokenConfig;
    try {
      spentUSD += computeUsageCostUSD(usage, params.pricing, endpointTokenConfig);
    } catch {
      /* skip a single unpriceable usage entry — never let the guard throw */
    }
  }

  const spentCredits = Math.round(spentUSD * CREDITS_PER_USD);
  const bufferCredits = params.bufferCredits ?? 0;
  if (balanceCredits - spentCredits > bufferCredits) {
    return { exhausted: false, balanceCredits, spentCredits };
  }

  return {
    exhausted: true,
    balanceCredits,
    spentCredits,
    errorMessage: {
      type: ViolationTypes.TOKEN_BALANCE,
      balance: balanceCredits,
      tokenCost: spentCredits,
      promptTokens: 0,
    },
  };
}

export interface AgentTurnBalanceGuardOptions extends EvaluateAgentTurnBalanceParams {
  /** Whether the balance recheck is active (balance enabled + endpoint supports it). */
  enabled: boolean;
  /**
   * Invoked once, on the first turn found to be over budget. The caller owns the
   * stop mechanism (log a violation, surface the balance error, terminate the
   * run). If it throws, the throw propagates to stop the run.
   */
  onExhausted: (
    errorMessage: TokenBalanceViolation,
    result: AgentTurnBalanceResult,
  ) => void | Promise<void>;
  logger?: { debug?: (message: string) => void; warn?: (message: string) => void };
}

/**
 * SDK event handler shape. The per-turn guard ignores every argument (it reads
 * only the live `collectedUsage` reference and the stored balance), so the
 * callback params are typed structurally without pulling the SDK's handler type.
 */
export interface AgentTurnBalanceGuardHandler {
  handle: (event?: string, data?: unknown, metadata?: unknown, graph?: unknown) => Promise<void>;
}

/**
 * Builds a `CHAT_MODEL_START` handler that re-checks the user's balance before
 * every agent turn EXCEPT the first (which the pre-request check in
 * `BaseClient` already covered). When the run's in-flight spend has drained the
 * balance to/under the buffer, it invokes `onExhausted` exactly once.
 *
 * Read-only and non-regressive: disabled runs are a no-op, and a failed balance
 * read fails OPEN (the turn proceeds) so a transient DB blip never blocks a
 * paid-up user — the authoritative post-run billing (with its zero floor) still
 * applies.
 */
export function createAgentTurnBalanceGuard(
  options: AgentTurnBalanceGuardOptions,
): AgentTurnBalanceGuardHandler {
  let seenFirstTurn = false;
  let triggered = false;

  return {
    handle: async () => {
      if (!options.enabled || triggered) {
        return;
      }
      if (!seenFirstTurn) {
        seenFirstTurn = true;
        return;
      }

      let result: AgentTurnBalanceResult;
      try {
        result = await evaluateAgentTurnBalance(options);
      } catch (error) {
        options.logger?.warn?.(
          `[balanceRecheck] Skipping turn balance check after read failure: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return;
      }

      if (!result.exhausted || !result.errorMessage) {
        return;
      }

      triggered = true;
      options.logger?.debug?.(
        `[balanceRecheck] Balance exhausted mid-run (balance=${result.balanceCredits}, spent=${result.spentCredits}); stopping run`,
      );
      await options.onExhausted(result.errorMessage, result);
    },
  };
}
