import { logger } from '@librechat/data-schemas';

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
  /** Current-month usage in USD (OpenRouter's own monthly window, UTC). */
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
