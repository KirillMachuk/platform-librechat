import { logger, microUsdToCredits } from '@librechat/data-schemas';
import type {
  AddCreditPackageInput,
  AddCreditPackageResult,
  AuditLogInput,
  CreditLotKind,
  CreditBillingStatus,
  CreditPackageWithRemaining,
} from '@librechat/data-schemas';
import type { Response } from 'express';
import type { OpenRouterManagement } from '~/billing/openrouter';
import type { ReconcileReport } from '~/billing/reconcile';
import type { ServerRequest } from '~/types/http';
import { computeKeyLimitUsd, shouldApplyKeyLimit } from '~/billing/openrouter';
import { auditRequestContext } from '~/audit/service';

/** Contract package sizes (Credits). Anything else is a validation error. */
export const CREDIT_PACKAGE_SIZES = [5_000, 10_000, 30_000] as const;

/**
 * Ceiling on a single manual adjustment (Credits, either sign). Adjustments exist for
 * refunds, clawbacks and off-contract top-ups paid by bank transfer — all human-scale.
 * A larger correction is a typo far more often than an intent, and at this size the
 * damage (a wrongly unblocked or blocked contour) outlives the mistake.
 */
export const MAX_ADJUSTMENT_CREDITS = 50_000;

type PackageSize = (typeof CREDIT_PACKAGE_SIZES)[number];

const MAX_COMMENT_LEN = 500;
const MAX_IDEMPOTENCY_KEY_LEN = 128;

export interface AdminBillingLot {
  id: string;
  kind: CreditLotKind;
  credits: number;
  remainingCredits: number;
  comment?: string;
  invoiceRef?: string;
  addedByEmail?: string;
  createdAt?: string;
}

/** Client-admin-safe summary: Credits and percentages only — no $, no tokens. */
export interface AdminBillingSummary {
  /** Billing-period key (`YYYY-MM-DD`, the Minsk period-start date). */
  month: string;
  /** Period bounds as ISO instants — the UI renders «период 15 июля — 14 августа». */
  periodStart?: string | null;
  periodEnd?: string | null;
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
  /**
   * Whether spend metering is actually wired (BILLING_INTERNAL_TOKEN set). When
   * false the ledger stays at zero because the anonymizer cannot report cost — the
   * screen shows an «учёт не активирован» banner instead of a misleading 0%.
   */
  metering: boolean;
  /**
   * Whether the ledger's unique indexes failed to build (idempotency/dedupe degraded).
   * Surfaced so the operator screen can warn instead of trusting the numbers silently.
   */
  degraded: boolean;
}

export interface AdminBillingDeps {
  getCreditBillingStatus: (params: {
    poolMicroUsd: number;
    tenantId?: string;
    anchorDay?: number;
  }) => Promise<CreditBillingStatus>;
  listCreditPackages: (params?: {
    tenantId?: string;
  }) => Promise<{ packages: CreditPackageWithRemaining[]; packageSpentMicroUsd: number }>;
  addCreditPackage: (input: AddCreditPackageInput) => Promise<AddCreditPackageResult>;
  poolMicroUsd: number;
  tenantId?: string;
  /** Service-period anchor day (1–31; defaults to 1 = calendar month). */
  anchorDay?: number;
  /** Whether spend metering is wired (BILLING_INTERNAL_TOKEN set) — surfaced to the UI. */
  metering: boolean;
  /** Live getter for ledger index health — true when unique indexes failed to build. */
  getDegraded?: () => boolean;
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

/**
 * An adjustment's comment is mandatory and free-form, so it is where an operator writes
 * the real reason — «возврат $37 за перерасход ключа», an invoice, an internal note. The
 * lot table is visible to the CLIENT admin, who contractually sees only Credits and
 * percentages, so that text is withheld from everyone but the operator. Package comments
 * stay visible: they are invoice references the client needs for акты.
 */
function toLot(pkg: CreditPackageWithRemaining, isOperator: boolean): AdminBillingLot {
  const hideComment = pkg.kind === 'adjustment' && !isOperator;
  return {
    id: pkg.id,
    kind: pkg.kind,
    credits: pkg.credits,
    remainingCredits: Math.max(0, microUsdToCredits(pkg.remainingMicroUsd)),
    comment: hideComment ? undefined : pkg.comment,
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
      deps.getCreditBillingStatus({
        poolMicroUsd: deps.poolMicroUsd,
        tenantId: deps.tenantId,
        anchorDay: deps.anchorDay,
      }),
      deps.listCreditPackages({ tenantId: deps.tenantId }),
    ]);
    /* Display math is done once, in whole Credits, so «остаток + израсходовано»
     * always reconciles on screen (single rounding point). */
    const poolCredits = microUsdToCredits(status.poolMicroUsd);
    const spentCredits = microUsdToCredits(status.spentMicroUsd);
    const percentUsed =
      status.poolMicroUsd > 0 ? Math.round((status.spentMicroUsd / status.poolMicroUsd) * 100) : 0;
    const isOperator = isOperatorRequest(req, deps.operatorEmails);
    return {
      month: status.month,
      periodStart: status.periodStart ? new Date(status.periodStart).toISOString() : null,
      periodEnd: status.periodEnd ? new Date(status.periodEnd).toISOString() : null,
      blocked: status.blocked,
      warn80: percentUsed >= 80,
      poolCredits,
      spentCredits,
      poolRemainingCredits: Math.max(0, poolCredits - spentCredits),
      percentUsed,
      packagePurchasedCredits: microUsdToCredits(status.purchasedMicroUsd),
      /* NOT clamped at 0: an over-clawback leaves a real debt, and hiding it as «0»
       * means a freshly paid package silently vanishes into it while the contour stays
       * blocked — the operator would see no reason and charge the client twice. */
      packageRemainingCredits: microUsdToCredits(status.packageRemainingMicroUsd),
      lots: lots.packages.map((lot) => toLot(lot, isOperator)),
      isOperator,
      metering: deps.metering,
      degraded: deps.getDegraded ? deps.getDegraded() : false,
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
   * Updates the OpenRouter key's monthly limit to the worst-case volume of one key
   * window (see {@link computeKeyLimitUsd}) so the hard fuse stays above the allowed
   * volume instead of cutting in ahead of the soft block. Best-effort: when
   * unconfigured/failed, the operator gets the recommended number to set manually.
   */
  async function syncOpenRouterLimit(req: ServerRequest): Promise<{
    mode: 'auto' | 'manual' | 'unchanged';
    limitUsd?: number;
    recommendedLimitUsd: number;
  }> {
    const status = await deps.getCreditBillingStatus({
      poolMicroUsd: deps.poolMicroUsd,
      tenantId: deps.tenantId,
      anchorDay: deps.anchorDay,
    });
    const recommendedLimitUsd = computeKeyLimitUsd({
      poolMicroUsd: deps.poolMicroUsd,
      packageRemainingMicroUsd: status.packageRemainingMicroUsd,
      anchorDay: deps.anchorDay,
      headroom: deps.limitHeadroom,
    });
    if (!deps.openrouter?.isConfigured) {
      return { mode: 'manual', recommendedLimitUsd };
    }
    try {
      /* A negative adjustment LOWERS the computed limit, so this path can now ask for a
       * tighter fuse — which OpenRouter turns into an instant contour-wide cut whenever
       * it lands under the usage already accrued this month. Same rule as the daily sync. */
      const key = await deps.openrouter.getKey();
      if (!shouldApplyKeyLimit(key, recommendedLimitUsd)) {
        return { mode: 'unchanged', limitUsd: key.limitUsd ?? undefined, recommendedLimitUsd };
      }
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
        kind?: unknown;
        credits?: unknown;
        comment?: unknown;
        invoiceRef?: unknown;
        idempotencyKey?: unknown;
      };
      const kind: CreditLotKind = body.kind === 'adjustment' ? 'adjustment' : 'package';
      const credits = body.credits;
      const comment =
        typeof body.comment === 'string'
          ? body.comment.trim().slice(0, MAX_COMMENT_LEN)
          : undefined;

      if (typeof credits !== 'number' || !Number.isFinite(credits)) {
        return res.status(400).json({ error: 'credits must be a number' });
      }
      if (kind === 'package' && !CREDIT_PACKAGE_SIZES.includes(credits as PackageSize)) {
        return res
          .status(400)
          .json({ error: `credits must be one of: ${CREDIT_PACKAGE_SIZES.join(', ')}` });
      }
      if (kind === 'adjustment') {
        if (!Number.isInteger(credits) || credits === 0) {
          return res
            .status(400)
            .json({ error: 'Корректировка должна быть целым числом Кредитов, не равным нулю' });
        }
        if (Math.abs(credits) > MAX_ADJUSTMENT_CREDITS) {
          return res.status(400).json({
            error: `Корректировка не может превышать ${MAX_ADJUSTMENT_CREDITS} Кредитов по модулю`,
          });
        }
        /* A package carries its own paper trail (fixed size, invoice); an adjustment is
         * an off-contract movement of money whose only trace is what the operator types. */
        if (!comment) {
          return res.status(400).json({ error: 'Для корректировки обязателен комментарий' });
        }
      }

      const idempotencyKey =
        typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
      if (!idempotencyKey || idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LEN) {
        return res.status(400).json({ error: 'idempotencyKey is required' });
      }
      const invoiceRef =
        typeof body.invoiceRef === 'string'
          ? body.invoiceRef.trim().slice(0, MAX_COMMENT_LEN)
          : undefined;

      const result = await deps.addCreditPackage({
        kind,
        credits,
        comment,
        invoiceRef,
        idempotencyKey,
        addedByEmail: req.user?.email,
        addedById: req.user?._id?.toString() ?? req.user?.id,
        tenantId: deps.tenantId,
        /* Without it the «exhausted» flag is cleared on the WRONG period document
         * whenever the anchor is not the 1st, and the contour then goes silent on its
         * next exhaustion. The CLI has always passed it; this path had not. */
        anchorDay: deps.anchorDay,
      });

      /* A replayed idempotency key must not double anything — including audit. */
      if (result.created) {
        deps.recordAudit({
          ...actorFields(req),
          action: kind === 'adjustment' ? 'billing.adjustment_added' : 'billing.package_added',
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
