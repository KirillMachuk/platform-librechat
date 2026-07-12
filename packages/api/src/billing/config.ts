import { creditsToMicroUsd } from '@librechat/data-schemas';

/** Default included pool: 25 000 Credits per team per calendar month (Europe/Minsk). */
export const DEFAULT_POOL_CREDITS = 25_000;
/** OpenRouter key limit headroom over the internally allowed volume (~10%). */
export const DEFAULT_LIMIT_HEADROOM = 0.1;

export interface BillingConfig {
  /** Ingest/status endpoints refuse to work without the shared secret. */
  enabled: boolean;
  internalToken: string;
  poolCredits: number;
  poolMicroUsd: number;
  /** Lowercased emails of platform (1ma) operators — the only principals allowed to add packages. */
  operatorEmails: string[];
  /** Alert recipients; defaults to the operator list. */
  notifyEmails: string[];
  openrouter: {
    managementKey?: string;
    keyHash?: string;
    baseUrl: string;
    headroom: number;
  };
}

function csv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Reads the billing environment once at route wiring.
 *
 * The operator allowlist is an env var *by design*: the client's own admin
 * manages roles/capabilities in the admin panel and could grant themselves any
 * role-based permission, so «оператор платформы» must live outside the data
 * the client admin controls.
 */
export function readBillingConfig(env: NodeJS.ProcessEnv = process.env): BillingConfig {
  const poolCredits = Number.parseInt(env.BILLING_MONTHLY_POOL_CREDITS ?? '', 10);
  const resolvedPool =
    Number.isFinite(poolCredits) && poolCredits > 0 ? poolCredits : DEFAULT_POOL_CREDITS;
  const operatorEmails = csv(env.BILLING_OPERATOR_EMAILS);
  const notifyEmails = csv(env.BILLING_NOTIFY_EMAILS);
  const headroom = Number.parseFloat(env.BILLING_OPENROUTER_LIMIT_HEADROOM ?? '');
  return {
    enabled: Boolean(env.BILLING_INTERNAL_TOKEN),
    internalToken: env.BILLING_INTERNAL_TOKEN ?? '',
    poolCredits: resolvedPool,
    poolMicroUsd: creditsToMicroUsd(resolvedPool),
    operatorEmails,
    notifyEmails: notifyEmails.length > 0 ? notifyEmails : operatorEmails,
    openrouter: {
      managementKey: env.OPENROUTER_MANAGEMENT_KEY || undefined,
      keyHash: env.OPENROUTER_KEY_HASH || undefined,
      baseUrl: env.OPENROUTER_MANAGEMENT_BASE_URL || 'https://openrouter.ai/api/v1',
      headroom: Number.isFinite(headroom) && headroom >= 0 ? headroom : DEFAULT_LIMIT_HEADROOM,
    },
  };
}
