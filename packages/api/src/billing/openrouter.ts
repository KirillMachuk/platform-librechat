import { logger, normalizeAnchorDay, MICRO_USD_PER_USD } from '@librechat/data-schemas';
import { DEFAULT_LIMIT_HEADROOM } from './config';

/**
 * Minimal OpenRouter key-management client (Provisioning/Management API).
 * Used for the hard financial fuse: the contour key's monthly limit is kept
 * slightly ABOVE the internally allowed volume (pool + active packages + ~10%),
 * so the soft block always engages before OpenRouter hard-cuts the key.
 *
 * Requires a *management* key (cannot call completions) and the contour key's
 * hash. When either is absent the integration reports `isConfigured: false`
 * and the operator follows the manual dashboard procedure instead.
 */
export interface OpenRouterKeyInfo {
  /** Key spend limit in OpenRouter credits (≡ USD); null when unlimited. */
  limitUsd: number | null;
  /** Lifetime usage in USD. */
  usageUsd: number | null;
  /**
   * Usage in the current UTC CALENDAR month. OpenRouter's monthly window resets at
   * 00:00 UTC on the 1st (per its Provisioning API docs — daily=midnight UTC,
   * weekly=Mon–Sun, monthly=calendar 1st). The reconciler's journal window is aligned
   * to exactly this (`startOfUtcMonth(now)` → now), so the two are directly comparable.
   */
  usageMonthlyUsd: number | null;
  disabled: boolean;
  raw: unknown;
}

export interface OpenRouterManagement {
  isConfigured: boolean;
  getKey: () => Promise<OpenRouterKeyInfo>;
  /** Sets the key's limit (USD) with monthly reset. */
  updateLimit: (limitUsd: number) => Promise<void>;
}

export interface OpenRouterManagementOptions {
  managementKey?: string;
  keyHash?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

function toNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * The key limit (USD) that keeps the hard fuse just above the volume the contour may
 * legitimately spend inside ONE key window.
 *
 * The key resets on the UTC calendar month (`limit_reset: 'monthly'`), while the billing
 * period is a rolling «month of service» anchored to `anchorDay`. With any anchor other
 * than the 1st, one UTC month straddles the tail of one period and the head of the next,
 * so up to TWO full pools can be spent legitimately inside a single key window. A limit
 * sized for one pool would hard-cut the key — every model dead contour-wide — *before*
 * the soft block ever engages. Sizing for that worst case keeps the fuse a fuse: it still
 * stops a runaway (a fail-open gate plus a loop), while the precise, period-accurate
 * ceiling remains the soft block.
 */
/**
 * Whether moving the key's fuse to `desiredLimitUsd` is safe to do automatically.
 *
 * The computed limit legitimately FALLS during a month — packages drain, a clawback is
 * applied — and OpenRouter disables a key the moment its limit is at or below what it
 * has already used. So an automatic «tightening» that lands under the accrued usage does
 * not tighten anything: it kills every model contour-wide, mid-month, while the client
 * still has pool left. That is the exact outage the fuse exists to prevent, so both the
 * daily sync and the admin top-up path route through this check rather than each
 * remembering the rule.
 */
export function shouldApplyKeyLimit(
  key: Pick<OpenRouterKeyInfo, 'limitUsd' | 'usageMonthlyUsd'>,
  desiredLimitUsd: number,
): boolean {
  if (key.limitUsd === desiredLimitUsd) {
    return false;
  }
  return key.usageMonthlyUsd == null || desiredLimitUsd > key.usageMonthlyUsd;
}

export function computeKeyLimitUsd(params: {
  poolMicroUsd: number;
  packageRemainingMicroUsd?: number;
  anchorDay?: number;
  headroom?: number;
}): number {
  const poolsPerKeyWindow = normalizeAnchorDay(params.anchorDay) === 1 ? 1 : 2;
  const packageRemaining = Math.max(0, params.packageRemainingMicroUsd ?? 0);
  const worstCaseMicroUsd = params.poolMicroUsd * poolsPerKeyWindow + packageRemaining;
  const headroom = params.headroom ?? DEFAULT_LIMIT_HEADROOM;
  return Math.ceil((worstCaseMicroUsd / MICRO_USD_PER_USD) * (1 + headroom));
}

/**
 * OpenRouter wraps the key in `{ data: {...} }`. A different shape means the
 * Provisioning API contract changed under us — warn loudly (otherwise every usage
 * field silently reads as null and the reconciler goes blind to real drift) and
 * degrade to an empty object so callers still get a well-formed, all-null result.
 */
function extractKeyData(body: unknown): Record<string, unknown> {
  if (body && typeof body === 'object' && 'data' in body) {
    const data = (body as { data: unknown }).data;
    if (data && typeof data === 'object') {
      return data as Record<string, unknown>;
    }
  }
  logger.warn(
    '[openrouter] GET key returned an unexpected shape (no `data` object); usage fields read as null — verify the Provisioning API contract',
  );
  return {};
}

export function createOpenRouterManagement(
  options: OpenRouterManagementOptions,
): OpenRouterManagement {
  const baseUrl = (options.baseUrl ?? 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;
  const isConfigured = Boolean(options.managementKey && options.keyHash);

  function headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${options.managementKey}`,
      'Content-Type': 'application/json',
    };
  }

  function requireConfigured(): void {
    if (!isConfigured) {
      throw new Error(
        '[openrouter] management API is not configured (OPENROUTER_MANAGEMENT_KEY / OPENROUTER_KEY_HASH)',
      );
    }
  }

  async function getKey(): Promise<OpenRouterKeyInfo> {
    requireConfigured();
    const res = await fetchImpl(`${baseUrl}/keys/${options.keyHash}`, { headers: headers() });
    if (!res.ok) {
      throw new Error(`[openrouter] GET key failed: ${res.status}`);
    }
    const data = extractKeyData(await res.json());
    return {
      limitUsd: toNumberOrNull(data.limit),
      usageUsd: toNumberOrNull(data.usage),
      usageMonthlyUsd: toNumberOrNull(data.usage_monthly),
      disabled: data.disabled === true,
      raw: data,
    };
  }

  async function updateLimit(limitUsd: number): Promise<void> {
    requireConfigured();
    if (!Number.isFinite(limitUsd) || limitUsd <= 0) {
      throw new Error(`[openrouter] invalid limit: ${limitUsd}`);
    }
    const res = await fetchImpl(`${baseUrl}/keys/${options.keyHash}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ limit: limitUsd, limit_reset: 'monthly' }),
    });
    if (!res.ok) {
      throw new Error(`[openrouter] PATCH key limit failed: ${res.status}`);
    }
    logger.info(`[openrouter] key limit updated to $${limitUsd}/month`);
  }

  return { isConfigured, getKey, updateLimit };
}
