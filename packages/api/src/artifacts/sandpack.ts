import { logger } from '@librechat/data-schemas';

/**
 * Official CodeSandbox bundler origins Sandpack ships with. When
 * `SANDPACK_BUNDLER_URL` is unset the client sends `undefined` and Sandpack uses
 * one of these internally; when it IS set, we only forward it if its origin is
 * one of these (or an operator-approved self-host).
 */
const DEFAULT_ALLOWED_BUNDLER_ORIGINS = [
  'https://sandpack-bundler.codesandbox.io',
  'https://bundler.codesandbox.io',
] as const;

/**
 * Resolves the allowlist of trusted bundler origins from the built-in
 * CodeSandbox origins plus any operator-approved self-host origins in
 * `SANDPACK_BUNDLER_ALLOWED_ORIGINS` (comma-separated).
 */
export const getAllowedBundlerOrigins = (env: NodeJS.ProcessEnv = process.env): string[] => {
  const extra = (env.SANDPACK_BUNDLER_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return [...DEFAULT_ALLOWED_BUNDLER_ORIGINS, ...extra];
};

/**
 * Returns `rawUrl` only when it is an https URL whose origin is allowlisted;
 * otherwise `undefined`. The bundler URL controls the JavaScript executed inside
 * the Sandpack preview iframe, so an attacker-controlled or misconfigured origin
 * would run arbitrary JS there. Returning `undefined` makes the client fall back
 * to Sandpack's built-in default bundler (still functional), rather than trusting
 * an unvetted origin. An unset value is passed through as `undefined` unchanged.
 *
 * @param rawUrl - The configured bundler URL (e.g. `SANDPACK_BUNDLER_URL`).
 * @param env - Environment to read the allowlist from (defaults to process.env).
 * @param label - Human-readable name of the setting, used only in the warn log.
 */
export const resolveTrustedBundlerURL = (
  rawUrl: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  label = 'SANDPACK_BUNDLER_URL',
): string | undefined => {
  if (!rawUrl) {
    return undefined;
  }

  let origin: string;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:') {
      logger.warn(`[sandpack] Ignoring ${label}: only https bundler URLs are allowed (got ${url.protocol})`);
      return undefined;
    }
    origin = url.origin;
  } catch {
    logger.warn(`[sandpack] Ignoring ${label}: not a valid URL`);
    return undefined;
  }

  if (!getAllowedBundlerOrigins(env).includes(origin)) {
    logger.warn(
      `[sandpack] Ignoring ${label}: origin ${origin} is not allowlisted. Add it to SANDPACK_BUNDLER_ALLOWED_ORIGINS to trust a self-hosted bundler.`,
    );
    return undefined;
  }

  return rawUrl;
};
