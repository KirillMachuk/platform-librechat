import { logger, microUsdToCredits, MICRO_USD_PER_USD } from '@librechat/data-schemas';
import type {
  AddCreditPackageInput,
  AddCreditPackageResult,
  AuditLogInput,
  CreditBillingStatus,
  CreditPackageWithRemaining,
} from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import type { ReconcileReport } from '~/billing/reconcile';
import type { OpenRouterManagement } from '~/billing/openrouter';
import { auditRequestContext } from '~/audit/service';

/** Contract package sizes (Credits). Anything else is a validation error. */
export const CREDIT_PACKAGE_SIZES = [5_000, 10_000, 30_000] as const;

const MAX_COMMENT_LEN = 500;
const MAX_IDEMPOTENCY_KEY_LEN = 128;

export interface AdminBillingLot {
  id: string;
  credits: number;
  remainingCredits: number;
  comment?: string;
  invoiceRef?: string;
  addedByEmail?: string;
  createdAt?: string;
}

/** Client-admin-safe summary: Credits and percentages only — no $, no tokens. */
export interface AdminBillingSummary {
  month: string;
  blocked: boolean;
  warn80: boolean;
  poolCredits: number;
  /** Израсходовано за месяц (включая пакетную часть), целые Кредиты. */
  spentCredits: number;
  poolRemainingCredits: number;
  /** May exceed 100 after a boundary overrun. */
  percentUsed: number;
  packagePurchasedCredits: number;
  packageRemainingCredits: number;
  lots: AdminBillingLot[];
  /** Whether the current session user is a platform (1ma) operator. */
  isOperator: boolean;
}

export interface AdminBillingDeps {
  getCreditBillingStatus: (params: {
    poolMicroUsd: number;
    tenantId?: string;
  }) => Promise<CreditBillingStatus>;
  listCreditPackages: (params?: {
    tenantId?: string;
  }) => Promise<{ packages: CreditPackageWithRemaining[]; packageSpentMicroUsd: number }>;
  addCreditPackage: (input: AddCreditPackageInput) => Promise<AddCreditPackageResult>;
  poolMicroUsd: number;
  tenantId?: string;
  /** Lowercased operator allowlist (env-driven — outside client-admin control). */
  operatorEmails: string[];
  /** OpenRouter limit headroom over the allowed volume (e.g. 0.1 = +10%). */
  limitHeadroom: number;
  openrouter?: OpenRouterManagement;
  reconciler?: { run: () => Promise<ReconcileReport> };
  recordAudit: (event: AuditLogInput) => void;
}

function isOperatorRequest(req: ServerRequest, operatorEmails: string[]): boolean {
  const email = req.user?.email?.toLowerCase();
  return Boolean(email && operatorEmails.includes(email));
}

function toLot(pkg: CreditPackageWithRemaining): AdminBillingLot {
  return {
    id: pkg.id,
    credits: pkg.credits,
    remainingCredits: Math.max(0, microUsdToCredits(pkg.remainingMicroUsd)),
    comment: pkg.comment,
    invoiceRef: pkg.invoiceRef,
    addedByEmail: pkg.addedByEmail,
    createdAt: pkg.createdAt ? new Date(pkg.createdAt).toISOString() : undefined,
  };
}

function actorFields(req: ServerRequest) {
  return {
    actorId: req.user?._id?.toString() ?? req.user?.id,
    actorEmail: req.user?.email,
    actorRole: req.user?.role,
  };
}

export function createAdminBillingHandlers(deps: AdminBillingDeps): {
  getSummary: (req: ServerRequest, res: Response) => Promise<Response>;
  addPackage: (req: ServerRequest, res: Response) => Promise<Response>;
  reconcile: (req: ServerRequest, res: Response) => Promise<Response>;
} {
  async function buildSummary(req: ServerRequest): Promise<AdminBillingSummary> {
    const [status, lots] = await Promise.all([
      deps.getCreditBillingStatus({ poolMicroUsd: deps.poolMicroUsd, tenantId: deps.tenantId }),
      deps.listCreditPackages({ tenantId: deps.tenantId }),
    ]);
    /* Display math is done once, in whole Credits, so «остаток + израсходовано»
     * always reconciles on screen (single rounding point). */
    const poolCredits = microUsdToCredits(status.poolMicroUsd);
    const spentCredits = microUsdToCredits(status.spentMicroUsd);
    const percentUsed =
      status.poolMicroUsd > 0 ? Math.round((status.spentMicroUsd / status.poolMicroUsd) * 100) : 0;
    return {
      month: status.month,
      blocked: status.blocked,
      warn80: percentUsed >= 80,
      poolCredits,
      spentCredits,
      poolRemainingCredits: Math.max(0, poolCredits - spentCredits),
      percentUsed,
      packagePurchasedCredits: microUsdToCredits(status.purchasedMicroUsd),
      packageRemainingCredits: Math.max(0, microUsdToCredits(status.packageRemainingMicroUsd)),
      lots: lots.packages.map(toLot),
      isOperator: isOperatorRequest(req, deps.operatorEmails),
    };
  }

  async function getSummaryHandler(req: ServerRequest, res: Response) {
    try {
      return res.status(200).json(await buildSummary(req));
    } catch (error) {
      logger.error('[adminBilling] getSummary error:', error);
      return res.status(500).json({ error: 'Failed to get billing summary' });
    }
  }

  /**
   * Updates the OpenRouter key's monthly limit to (pool + package remaining) ×
   * (1 + headroom) so the hard fuse stays just above the allowed volume.
   * Best-effort: when unconfigured/failed, the operator gets the recommended
   * number to set manually in the dashboard.
   */
  async function syncOpenRouterLimit(
    req: ServerRequest,
  ): Promise<{ mode: 'auto' | 'manual'; limitUsd?: number; recommendedLimitUsd: number }> {
    const status = await deps.getCreditBillingStatus({
      poolMicroUsd: deps.poolMicroUsd,
      tenantId: deps.tenantId,
    });
    const allowedMicroUsd = deps.poolMicroUsd + Math.max(0, status.packageRemainingMicroUsd);
    const recommendedLimitUsd = Math.ceil(
      (allowedMicroUsd / MICRO_USD_PER_USD) * (1 + deps.limitHeadroom),
    );
    if (!deps.openrouter?.isConfigured) {
      return { mode: 'manual', recommendedLimitUsd };
    }
    try {
      await deps.openrouter.updateLimit(recommendedLimitUsd);
      deps.recordAudit({
        ...actorFields(req),
        action: 'billing.limit_updated',
        targetType: 'billing',
        targetId: 'openrouter-key',
        metadata: { limitUsd: recommendedLimitUsd },
        ...auditRequestContext(req),
      });
      return { mode: 'auto', limitUsd: recommendedLimitUsd, recommendedLimitUsd };
    } catch (error) {
      logger.error('[adminBilling] OpenRouter limit update failed:', error);
      return { mode: 'manual', recommendedLimitUsd };
    }
  }

  async function addPackageHandler(req: ServerRequest, res: Response) {
    try {
      if (!isOperatorRequest(req, deps.operatorEmails)) {
        return res
          .status(403)
          .json({ error: 'Начислять пакеты может только оператор платформы 1ma' });
      }

      const body = (req.body ?? {}) as {
        credits?: unknown;
        comment?: unknown;
        invoiceRef?: unknown;
        idempotencyKey?: unknown;
      };
      const credits = body.credits;
      if (
        typeof credits !== 'number' ||
        !CREDIT_PACKAGE_SIZES.includes(credits as (typeof CREDIT_PACKAGE_SIZES)[number])
      ) {
        return res
          .status(400)
          .json({ error: `credits must be one of: ${CREDIT_PACKAGE_SIZES.join(', ')}` });
      }
      const idempotencyKey =
        typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
      if (!idempotencyKey || idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LEN) {
        return res.status(400).json({ error: 'idempotencyKey is required' });
      }
      const comment =
        typeof body.comment === 'string'
          ? body.comment.trim().slice(0, MAX_COMMENT_LEN)
          : undefined;
      const invoiceRef =
        typeof body.invoiceRef === 'string'
          ? body.invoiceRef.trim().slice(0, MAX_COMMENT_LEN)
          : undefined;

      const result = await deps.addCreditPackage({
        credits,
        comment,
        invoiceRef,
        idempotencyKey,
        addedByEmail: req.user?.email,
        addedById: req.user?._id?.toString() ?? req.user?.id,
        tenantId: deps.tenantId,
      });

      /* A replayed idempotency key must not double anything — including audit. */
      if (result.created) {
        deps.recordAudit({
          ...actorFields(req),
          action: 'billing.package_added',
          targetType: 'billing',
          targetId: String(result.package._id),
          metadata: {
            credits,
            comment: comment ?? '',
            invoiceRef: invoiceRef ?? '',
            idempotencyKey,
          },
          ...auditRequestContext(req),
        });
      }

      const limitUpdate = result.created ? await syncOpenRouterLimit(req) : undefined;

      return res.status(result.created ? 201 : 200).json({
        created: result.created,
        summary: await buildSummary(req),
        limitUpdate,
      });
    } catch (error) {
      logger.error('[adminBilling] addPackage error:', error);
      return res.status(500).json({ error: 'Failed to add credit package' });
    }
  }

  async function reconcileHandler(req: ServerRequest, res: Response) {
    try {
      if (!isOperatorRequest(req, deps.operatorEmails)) {
        return res.status(403).json({ error: 'Сверка доступна только оператору платформы 1ma' });
      }
      if (!deps.reconciler) {
        return res.status(200).json({ configured: false });
      }
      const report = await deps.reconciler.run();
      return res.status(200).json(report);
    } catch (error) {
      logger.error('[adminBilling] reconcile error:', error);
      return res.status(500).json({ error: 'Failed to reconcile' });
    }
  }

  return {
    getSummary: getSummaryHandler,
    addPackage: addPackageHandler,
    reconcile: reconcileHandler,
  };
}
