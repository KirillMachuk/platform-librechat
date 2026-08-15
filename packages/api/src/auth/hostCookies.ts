import { logger } from '@librechat/data-schemas';
import type { NextFunction, Request, Response, CookieOptions } from 'express';
import { shouldUseSecureCookie } from '~/oauth/csrf';

/**
 * Auth cookies that must belong to exactly one host.
 *
 * A sibling subdomain is a different *origin* but the same *site*, so anything
 * running on one can write a cookie with `Domain=<registrable domain>` and the
 * browser will hand it to all the others. Host-only cookies do not stop that:
 * the attacker's copy is a second, differently-scoped cookie under the same
 * name, and `cookie.parse` keeps whichever comes first in the header — which
 * the attacker chooses by giving theirs a longer `Path`. The result is session
 * fixation: the victim keeps working, inside the attacker's account.
 *
 * The `__Host-` prefix is the fix the platform provides for this: a browser
 * only accepts such a cookie when it is `Secure`, has `Path=/` and carries no
 * `Domain` at all, so a neighbouring host cannot mint one.
 */
export const HOST_LOCKED_COOKIES: ReadonlySet<string> = new Set([
  'refreshToken',
  'token_provider',
  'openid_access_token',
  'openid_id_token',
  'openid_user_id',
]);

export const HOST_PREFIX = '__Host-';

/**
 * The `express-session` cookie behind OIDC and SAML sign-in. Deliberately NOT in
 * the set above, and deliberately not unwrapped on the way in: `express-session`
 * parses the raw header itself and matches whatever name it was configured with,
 * so it is told the prefixed name directly (see `configureOpenId`). Rewriting it
 * back to the short name — the treatment the five cookies get — would leave it
 * looking for a name that never arrives, i.e. no SSO session at all.
 *
 * Locking it matters because that session holds the identity provider's own
 * tokens; a neighbouring subdomain able to plant its value could have the
 * victim's real IdP tokens written into a session it already knows the id of.
 * With the prefixed name a planted bare `connect.sid` is simply a cookie nobody
 * reads.
 */
const SESSION_COOKIE_BASE_NAME = 'connect.sid';

/** Name for the OIDC/SAML `express-session` cookie in this environment. */
export const ssoSessionCookieName = (): string =>
  shouldUseSecureCookie() ? `${HOST_PREFIX}${SESSION_COOKIE_BASE_NAME}` : SESSION_COOKIE_BASE_NAME;

/**
 * Applied as one layer instead of renaming each call site. This is a fork: every
 * literal we touch is a conflict at the next upstream merge, and every cookie
 * upstream ADDS later would silently miss the rename. Wrapping the two Express
 * methods keeps the rest of the code writing `refreshToken` while the wire
 * carries `__Host-refreshToken`, and new call sites are covered by construction.
 */
function lockOutgoingCookies(res: Response): void {
  const originalCookie = res.cookie.bind(res);
  const originalClear = res.clearCookie.bind(res);

  res.cookie = function patchedCookie(
    name: string,
    value: string,
    options?: CookieOptions,
  ): Response {
    if (!HOST_LOCKED_COOKIES.has(name)) {
      return originalCookie(name, value, options as CookieOptions);
    }
    /** `__Host-` is rejected outright by the browser unless all three hold. */
    const locked: CookieOptions = { ...options, secure: true, path: '/' };
    delete locked.domain;
    return originalCookie(`${HOST_PREFIX}${name}`, value, locked);
  } as Response['cookie'];

  res.clearCookie = function patchedClearCookie(name: string, options?: CookieOptions): Response {
    if (!HOST_LOCKED_COOKIES.has(name)) {
      return originalClear(name, options as CookieOptions);
    }
    /**
     * The pre-prefix cookie is expired through `originalCookie`, not through
     * `clearCookie`: Express implements `clearCookie` in terms of `res.cookie`,
     * which is the method just replaced above — routing the legacy clear that way
     * sends it back through the prefixing branch and emits `__Host-` twice while
     * the old cookie is never touched. Measured in a real Express app; the browser
     * would keep an un-clearable leftover from before the rollout.
     */
    originalCookie(name, '', { ...options, path: '/', expires: new Date(0) });

    const locked: CookieOptions = { ...options, secure: true, path: '/' };
    delete locked.domain;
    return originalClear(`${HOST_PREFIX}${name}`, locked);
  } as Response['clearCookie'];
}

/**
 * Rewrites the incoming `Cookie` header so handlers keep reading the short names.
 *
 * Order matters twice over. Any un-prefixed copy of a locked name is DROPPED, not
 * merely reordered: that copy is precisely what a neighbouring host is able to
 * plant, and leaving it in would hand `cookie.parse` a choice we do not want it
 * to make. And the prefixed value is emitted first, so even a header we failed to
 * fully normalise resolves to the genuine cookie.
 */
export function rewriteIncomingCookieHeader(header: string | undefined): string | undefined {
  if (!header) {
    return header;
  }
  let sawLocked = false;
  const kept: string[] = [];
  const dropped: string[] = [];

  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    /**
     * Trimmed the way the `cookie` package trims when it parses: it drops the
     * optional whitespace around `=`, so `refreshToken =x` is `refreshToken` to
     * every handler downstream. Matching the raw substring instead let that
     * spelling walk straight past the drop rule.
     */
    const rawName = (eq === -1 ? trimmed : trimmed.slice(0, eq)).trim();

    if (
      rawName.startsWith(HOST_PREFIX) &&
      HOST_LOCKED_COOKIES.has(rawName.slice(HOST_PREFIX.length))
    ) {
      sawLocked = true;
      kept.unshift(`${rawName.slice(HOST_PREFIX.length)}${eq === -1 ? '' : trimmed.slice(eq)}`);
      continue;
    }
    if (HOST_LOCKED_COOKIES.has(rawName)) {
      dropped.push(rawName);
      continue;
    }
    kept.push(trimmed);
  }

  if (dropped.length > 0) {
    /** Either a session predating the prefix, or a cookie planted by a neighbour.
     *  The two are indistinguishable from here, which is the whole reason to drop. */
    logger.debug(`[hostCookies] dropped unprefixed auth cookie(s): ${dropped.join(', ')}`);
  }
  if (!sawLocked && dropped.length === 0) {
    return header;
  }
  return kept.join('; ');
}

/**
 * Mount FIRST, ahead of anything that reads `req.headers.cookie` — cookie-parser,
 * passport, and several handlers parse the raw header themselves.
 *
 * Inert wherever cookies are not `Secure` to begin with (localhost, the mock e2e
 * profile): a browser rejects a `__Host-` cookie over plain http, so switching it
 * on there would not harden anything, it would just make login impossible. The
 * same helper the cookie writers already use decides, so the two cannot disagree.
 */
export function hostLockedCookies(req: Request, res: Response, next: NextFunction): void {
  if (!shouldUseSecureCookie()) {
    return next();
  }
  const rewritten = rewriteIncomingCookieHeader(req.headers.cookie);
  if (rewritten === undefined) {
    delete req.headers.cookie;
  } else {
    req.headers.cookie = rewritten;
  }
  lockOutgoingCookies(res);
  next();
}
