import { logger, isValidObjectIdString, usdToMicroUsd } from '@librechat/data-schemas';
import type {
  CreditBillingStatus,
  RecordCreditSpendInput,
  RecordCreditSpendResult,
} from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';

/** Sanity ceiling for a single request's cost — rejects corrupted reports. */
const MAX_SINGLE_COST_USD = 1_000;
const MAX_FIELD_LEN = 300;

export interface BillingIngestDeps {
  recordCreditSpend: (input: RecordCreditSpendInput) => Promise<RecordCreditSpendResult>;
  getCreditBillingStatus: (params: {
    poolMicroUsd: number;
    tenantId?: string;
  }) => Promise<CreditBillingStatus>;
  poolMicroUsd: number;
  tenantId?: string;
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

      return res.status(200).json({ ok: true, month: result.month, duplicate: result.duplicate });
    } catch (error) {
      logger.error('[billingIngest] postSpend error:', error);
      return res.status(500).json({ error: 'Failed to record spend' });
    }
  }

  async function getStatusHandler(_req: ServerRequest, res: Response) {
    try {
      const status = await deps.getCreditBillingStatus({
        poolMicroUsd: deps.poolMicroUsd,
        tenantId: deps.tenantId,
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
