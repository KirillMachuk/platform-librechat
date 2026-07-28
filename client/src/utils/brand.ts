/**
 * This is a white-label fork: the client must never see the upstream name.
 *
 * Upstream's own default for the app title is "LibreChat", and it reaches us
 * from several directions — an unset APP_TITLE on the server, a stale value in
 * localStorage from an older build, or a config file that was never edited. So
 * the guard belongs in one place rather than being re-derived at each display
 * site, which is how it came to be spelled three slightly different ways.
 */
export const BRAND_NAME = '1ma';

const UPSTREAM_NAME = 'LibreChat';

/** The title to show, whatever the config or an old cache hands us. */
export function resolveAppTitle(rawTitle?: string | null): string {
  if (!rawTitle || rawTitle === UPSTREAM_NAME) {
    return BRAND_NAME;
  }
  return rawTitle;
}
