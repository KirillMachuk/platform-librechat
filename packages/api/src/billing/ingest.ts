import { logger, isValidObjectIdString, usdToMicroUsd } from '@librechat/data-schemas';
import type {
  CreditBillingStatus,
  RecordCreditSpendInput,
  RecordCreditSpendResult,
} from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';

/**
 * Sanity ceiling for a single request's cost — rejects corrupted reports.
 * One OpenRouter response costing >$100 (>5 000 Credits, ~40% of the monthly pool
 * in a single message) is anomalous by construction; a genuine spike is still
 * caught by the OpenRouter reconciliation, which is the backstop for under-counting.
 */
const MAX_SINGLE_COST_USD = 100;
const MAX_FIELD_LEN = 300;

export interface BillingIngestDeps {
  recordCreditSpend: (input: RecordCreditSpendInput) => Promise<RecordCreditSpendResult>;
  /**
   * Read-only gate status — the anonymizer polls this per request, so it must not
   * upsert (see `getCreditGateStatus`). A period with no document yet reads as not blocked.
   */
  getCreditGateStatus: (params: {
    poolMicroUsd: number;
    tenantId?: string;
    anchorDay?: number;
  }) => Promise<CreditBillingStatus>;
  poolMicroUsd: number;
  tenantId?: string;
  /** Service-period anchor day (1–31; defaults to 1 = calendar month). */
  anchorDay?: number;
  /** Fire-and-forget hook for threshold notifications; must never throw. */
  onSpendRecorded?: (result: RecordCreditSpendResult) => void;
}

interface SpendBody {
  costUsd?: unknown;
  model?: unknown;
  userId?: unknown;
  sourceId?: unknown;
  context?: unknown;
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, MAX_FIELD_LEN) : undefined;
}

/**
 * Internal ingest API for the anonymizer (the single LLM egress point).
 * The anonymizer reports each response's actual OpenRouter cost (`usage.cost`)
 * here and polls `/status` to enforce the soft block before forwarding.
 */
export function createBillingIngestHandlers(deps: BillingIngestDeps): {
  postSpend: (req: ServerRequest, res: Response) => Promise<Response>;
  getStatus: (req: ServerRequest, res: Response) => Promise<Response>;
} {
  async function postSpendHandler(req: ServerRequest, res: Response) {
    try {
      const body = (req.body ?? {}) as SpendBody;
      const costUsd = body.costUsd;
      if (typeof costUsd !== 'number' || !Number.isFinite(costUsd) || costUsd < 0) {
        return res.status(400).json({ error: 'costUsd must be a non-negative number' });
      }
      if (costUsd > MAX_SINGLE_COST_USD) {
        return res
          .status(400)
          .json({ error: `costUsd exceeds sanity limit (${MAX_SINGLE_COST_USD})` });
      }

      const userId = cleanString(body.userId);
      const result = await deps.recordCreditSpend({
        microUsd: usdToMicroUsd(costUsd),
        poolMicroUsd: deps.poolMicroUsd,
        tenantId: deps.tenantId,
        anchorDay: deps.anchorDay,
        model: cleanString(body.model),
        userId: userId && isValidObjectIdString(userId) ? userId : undefined,
        sourceId: cleanString(body.sourceId),
        context: cleanString(body.context),
      });

      if (deps.onSpendRecorded) {
        try {
          deps.onSpendRecorded(result);
        } catch (hookError) {
          logger.warn('[billingIngest] onSpendRecorded hook failed:', hookError);
        }
      }

      /* The money path must leave an audit trail: the anonymizer's own logger is not
       * always visible in the platform logs, so this line is the one place an operator
       * can SEE that a report arrived and was ledgered (or deduped). Low volume — one
       * line per model response. */
      logger.info(
        `[billingIngest] spend recorded: $${costUsd.toFixed(6)} model=${cleanString(body.model) ?? '-'} period=${result.month} duplicate=${result.duplicate} spentAfter=${result.spentAfterMicroUsd}µ$`,
      );

      return res.status(200).json({ ok: true, month: result.month, duplicate: result.duplicate });
    } catch (error) {
      logger.error('[billingIngest] postSpend error:', error);
      return res.status(500).json({ error: 'Failed to record spend' });
    }
  }

  async function getStatusHandler(_req: ServerRequest, res: Response) {
    try {
      const status = await deps.getCreditGateStatus({
        poolMicroUsd: deps.poolMicroUsd,
        tenantId: deps.tenantId,
        anchorDay: deps.anchorDay,
      });
      return res.status(200).json({
        blocked: status.blocked,
        month: status.month,
        poolMicroUsd: status.poolMicroUsd,
        spentMicroUsd: status.spentMicroUsd,
        packageRemainingMicroUsd: status.packageRemainingMicroUsd,
      });
    } catch (error) {
      logger.error('[billingIngest] getStatus error:', error);
      return res.status(500).json({ error: 'Failed to get billing status' });
    }
  }

  return { postSpend: postSpendHandler, getStatus: getStatusHandler };
}
