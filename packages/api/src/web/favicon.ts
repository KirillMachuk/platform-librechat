import jwt from 'jsonwebtoken';
import { isIP } from 'node:net';
import { fetch as undiciFetch } from 'undici';
import { logger } from '@librechat/data-schemas';
import type { RequestInit, Response as UndiciResponse } from 'undici';
import type { NextFunction, Request, Response } from 'express';
import { getEnvProxyDispatcher } from '~/utils/proxy';
import { isSSRFTarget } from '~/auth/domain';

/**
 * Source favicons, fetched by us instead of by the reader's browser.
 *
 * Until r28 every icon beside a search source was an `<img>` pointing straight at
 * an external icon service, so the browser of the client's employee announced to
 * a third party, one request per domain, which sites their research had surfaced.
 * On a platform whose selling point is that personal data is masked before it
 * reaches a model, that shipped the reading list past the perimeter — and it was
 * slow with it: measured 01.09.2026 from a laptop, every icon cost a redirect and
 * about 0.8s, and some domains never produced one at all.
 *
 * The endpoint below is the whole change: the browser asks us, we ask upstream
 * once per domain, and the answer is cached. What the reader's browser talks to
 * is now only ever this deployment.
 *
 * WHERE THE BYTES COME FROM. Measured on the stand against 124 domains taken from
 * real search results (`tools/favicon_source_probe.py`):
 *
 *   upstream icon service   95% of domains answered, p50 197ms, p50 610 bytes
 *   the site's /favicon.ico 69%,                     p50 238ms, p90 1031ms
 *   + its <link rel=icon>   90%,                     p90 1677ms, max 18s, some
 *                                                    icons over 256KB
 *
 * So we keep the icon service as upstream. Going to each source site directly
 * would show fewer icons, cost a far worse tail, and — the deciding argument —
 * would mean this endpoint fetching URLs read out of untrusted pages, which is
 * the thing it must never do. With a fixed upstream host we never connect to the
 * requested domain at all: it is a query parameter, not a destination.
 *
 * The residual is honest and small: upstream still learns a de-identified list of
 * domains, from this server, once per domain per TTL, with no user, no address
 * and no session attached — while the search queries themselves already leave the
 * perimeter to the search provider. Swapping upstream later is a change to
 * `upstreamUrl` alone; nothing else in the app knows where icons come from.
 */
const UPSTREAM_ORIGIN = 'https://www.google.com/s2/favicons';

/** Call sites render at 12–16 CSS px, i.e. 32 physical px on a 2× screen. */
const ICON_PIXELS = 32;

const FETCH_TIMEOUT_MS = 5_000;

/**
 * Measured p50 610 bytes and max 2955 bytes across the corpus above, so this is
 * five times the largest icon anyone has been served and twenty-five times the
 * median. It is a bound, not a budget: an answer over it is treated as no icon
 * rather than truncated, because half an icon decodes to nothing anyway.
 */
const MAX_ICON_BYTES = 16 * 1024;

/** Favicons change on the order of a rebrand. */
const HIT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Short, so a site that gains an icon is not stuck iconless for a week. */
const MISS_TTL_MS = 60 * 60 * 1000;

/**
 * The cache is bounded by bytes rather than left to expire, and it is in this
 * process rather than in Redis. The stand's Redis runs `maxmemory 0` with
 * `noeviction`, so an unbounded namespace there is not a cache that grows, it is
 * a way to make every Redis write in the app fail. Icons are the cheapest thing
 * in the system to re-fetch — one 200ms request, once — so the safe direction is
 * a hard ceiling and a cold start after a deploy. 8MB holds several thousand.
 */
const MAX_CACHE_BYTES = 8 * 1024 * 1024;

const HIT_MAX_AGE_S = 24 * 60 * 60;
const MISS_MAX_AGE_S = 60 * 60;

const MAX_DOMAIN_LENGTH = 253;
const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;

/** Labels of 1–63 chars, no leading or trailing hyphen, and at least one dot. */
const DOMAIN_PATTERN = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

const AUTH_COOKIE_NAMES = ['refreshToken', 'openid_user_id'] as const;

export interface FaviconIcon {
  body: Buffer;
  contentType: string;
}

export interface FaviconEntry {
  /** `null` is a first-class answer: upstream has no icon for this domain. */
  icon: FaviconIcon | null;
  expiresAt: number;
}

/**
 * Magic bytes decide the type, not the `Content-Type` upstream claims. We serve
 * these bytes back from our own origin, so the header has to describe what is
 * actually there. SVG is deliberately absent: it is a script-bearing document,
 * and nothing that reaches this endpoint needs one.
 */
const IMAGE_SIGNATURES: ReadonlyArray<{ magic: readonly number[]; contentType: string }> = [
  { magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], contentType: 'image/png' },
  { magic: [0x47, 0x49, 0x46, 0x38], contentType: 'image/gif' },
  { magic: [0xff, 0xd8, 0xff], contentType: 'image/jpeg' },
  { magic: [0x00, 0x00, 0x01, 0x00], contentType: 'image/x-icon' },
];

function imageTypeOf(body: Buffer): string | null {
  for (const { magic, contentType } of IMAGE_SIGNATURES) {
    if (body.length >= magic.length && magic.every((byte, index) => body[index] === byte)) {
      return contentType;
    }
  }
  if (
    body.length >= 12 &&
    body.toString('ascii', 0, 4) === 'RIFF' &&
    body.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * Turns the query parameter into a hostname we are willing to name to upstream,
 * or `null`.
 *
 * The value arrives from search results, i.e. from untrusted content, so it is
 * parsed rather than pattern-matched: a URL parse is what strips a smuggled
 * port, path, credential or fragment and punycodes an international domain,
 * instead of leaving those to a regular expression to notice.
 */
export function normalizeFaviconDomain(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw || raw.length > MAX_DOMAIN_LENGTH) {
    return null;
  }

  let hostname: string;
  try {
    hostname = new URL(`https://${raw.trim()}`).hostname;
  } catch {
    return null;
  }

  const domain = hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  if (!domain || domain.length > MAX_DOMAIN_LENGTH) {
    return null;
  }

  /** An address literal is never a source domain, and asking about one is a probe. */
  if (isIP(domain) !== 0) {
    return null;
  }

  if (!DOMAIN_PATTERN.test(domain)) {
    return null;
  }

  /** Rejects `.internal`/`.local` and the service names of our own compose network. */
  if (isSSRFTarget(domain)) {
    return null;
  }

  return domain;
}

/**
 * The one place a domain meets a URL, and the reason this endpoint needs no
 * DNS-resolving SSRF check: the host is a constant, the domain only ever rides
 * in the query, and `normalizeFaviconDomain` has already reduced it to
 * `[a-z0-9.-]`, so `encodeURIComponent` has nothing left to escape out of.
 *
 * ANY change that makes the requested domain part of the destination — a
 * different upstream, or going to the site itself — has to bring back
 * `resolveHostnameSSRF` from `~/auth/domain` with it. The spec pins the
 * invariant («never a destination»), so that change cannot land quietly.
 *
 * The check is not kept "just in case" because it is not free: `dns.lookup`
 * runs getaddrinfo on the libuv thread pool that the whole process shares with
 * the file system and crypto, it takes no abort signal, and the hostname would
 * be chosen by whoever wrote the search result.
 */
function upstreamUrl(domain: string): string {
  return `${UPSTREAM_ORIGIN}?domain=${encodeURIComponent(domain)}&sz=${ICON_PIXELS}`;
}

/**
 * Reads the body while counting, and gives up the moment the count passes `cap`.
 * Returning early inside `for await` cancels the stream, so an upstream that lies
 * about its length is disconnected rather than buffered.
 */
async function readCapped(response: UndiciResponse, cap: number): Promise<Buffer | null> {
  const stream = response.body;
  if (!stream) {
    return null;
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const part = Buffer.from(chunk);
    total += part.byteLength;
    if (total > cap) {
      return null;
    }
    chunks.push(part);
  }
  return total > 0 ? Buffer.concat(chunks) : null;
}

function fetchOptions(controller: AbortController): RequestInit {
  const options: RequestInit = {
    signal: controller.signal,
    headers: { accept: 'image/*' },
  };
  const dispatcher = getEnvProxyDispatcher();
  if (dispatcher) {
    options.dispatcher = dispatcher;
  }
  return options;
}

async function fetchIcon(domain: string): Promise<FaviconIcon | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await undiciFetch(upstreamUrl(domain), fetchOptions(controller));

    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }

    const body = await readCapped(response, MAX_ICON_BYTES);
    if (!body) {
      return null;
    }

    const contentType = imageTypeOf(body);
    if (!contentType) {
      return null;
    }

    return { body, contentType };
  } catch (error) {
    logger.debug(
      `[favicon] upstream failed for ${domain}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const ENTRY_OVERHEAD_BYTES = 128;

export interface FaviconCache {
  get(key: string, now: number): FaviconEntry | undefined;
  set(key: string, entry: FaviconEntry): void;
  clear(): void;
  readonly bytes: number;
  readonly size: number;
}

export function createFaviconCache(maxBytes: number): FaviconCache {
  const entries = new Map<string, FaviconEntry>();
  let usedBytes = 0;

  const weigh = (key: string, entry: FaviconEntry): number =>
    key.length + ENTRY_OVERHEAD_BYTES + (entry.icon?.body.byteLength ?? 0);

  const drop = (key: string): void => {
    const entry = entries.get(key);
    if (!entry) {
      return;
    }
    usedBytes -= weigh(key, entry);
    entries.delete(key);
  };

  return {
    get(key: string, now: number): FaviconEntry | undefined {
      const entry = entries.get(key);
      if (!entry) {
        return undefined;
      }
      if (entry.expiresAt <= now) {
        drop(key);
        return undefined;
      }
      /** Re-inserting moves it to the young end; eviction takes from the old end. */
      entries.delete(key);
      entries.set(key, entry);
      return entry;
    },
    set(key: string, entry: FaviconEntry): void {
      drop(key);
      entries.set(key, entry);
      usedBytes += weigh(key, entry);
      for (const oldest of entries.keys()) {
        if (usedBytes <= maxBytes) {
          break;
        }
        drop(oldest);
      }
    },
    clear(): void {
      entries.clear();
      usedBytes = 0;
    },
    get bytes(): number {
      return usedBytes;
    },
    get size(): number {
      return entries.size;
    },
  };
}

export const faviconCache = createFaviconCache(MAX_CACHE_BYTES);

/**
 * One upstream request per domain even when a message renders twenty icons at
 * once. Without this, opening a report with many sources on a cold cache would
 * fan out one outbound request per `<img>` rather than one per domain.
 */
const inFlight = new Map<string, Promise<FaviconEntry>>();

export async function resolveFavicon(domain: string): Promise<FaviconEntry> {
  const cached = faviconCache.get(domain, Date.now());
  if (cached) {
    return cached;
  }

  const pending = inFlight.get(domain);
  if (pending) {
    return pending;
  }

  const request = (async () => {
    const icon = await fetchIcon(domain);
    const entry: FaviconEntry = {
      icon,
      expiresAt: Date.now() + (icon ? HIT_TTL_MS : MISS_TTL_MS),
    };
    faviconCache.set(domain, entry);
    return entry;
  })().finally(() => inFlight.delete(domain));

  inFlight.set(domain, request);
  return request;
}

function cookieUserId(req: Request): string | null {
  const secret = process.env.JWT_REFRESH_SECRET;
  if (!secret) {
    return null;
  }
  const cookies = req.cookies as Record<string, string> | undefined;
  if (!cookies) {
    return null;
  }
  for (const name of AUTH_COOKIE_NAMES) {
    const token = cookies[name];
    if (!token) {
      continue;
    }
    try {
      const payload = jwt.verify(token, secret);
      if (typeof payload === 'string') {
        continue;
      }
      const id: unknown = payload.id;
      if (typeof id === 'string' && OBJECT_ID_PATTERN.test(id)) {
        return id;
      }
    } catch {
      /* Try the next cookie; an expired or foreign token is simply not proof. */
    }
  }
  return null;
}

/**
 * Authenticates from the session cookie rather than the `Authorization` header.
 *
 * An `<img>` cannot carry a header, and it has to stay an `<img>`: `loading=lazy`
 * is what keeps a collapsed list of sources — present in the DOM at zero height —
 * from firing one request per source the moment a message renders. This is the
 * same reasoning, and the same cookie, as `validateImageRequest` uses for the
 * `/images` route.
 *
 * The signature is the whole check: no user is loaded, so an account disabled a
 * minute ago keeps getting icons until its refresh token expires. That is the
 * deliberate trade — the alternative is a user lookup per icon, twenty of them
 * per message, to gate bytes that are a public site's logo either way.
 *
 * Must be mounted after `cookieParser`.
 */
export function faviconAuth(req: Request, res: Response, next: NextFunction): void {
  const userId = cookieUserId(req);
  if (!userId) {
    res.set('Cache-Control', 'no-store');
    res.status(401).end();
    return;
  }
  res.locals.userId = userId;
  next();
}

/**
 * One stable answer for "no icon": a 404 with nothing in it. The client already
 * treats an image that never arrives by keeping its neutral glyph, so there is no
 * placeholder byte stream to invent and no new client branch — and a 404 the
 * browser is allowed to cache stops it re-asking on every render.
 */
function sendNoIcon(res: Response): void {
  res.set('Cache-Control', `private, max-age=${MISS_MAX_AGE_S}`);
  res.status(404).end();
}

export async function faviconHandler(req: Request, res: Response): Promise<void> {
  const domain = normalizeFaviconDomain(req.query.domain);
  if (!domain) {
    sendNoIcon(res);
    return;
  }

  try {
    const { icon } = await resolveFavicon(domain);
    if (!icon) {
      sendNoIcon(res);
      return;
    }
    res.set({
      'Content-Type': icon.contentType,
      'Cache-Control': `private, max-age=${HIT_MAX_AGE_S}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
      'Cross-Origin-Resource-Policy': 'same-origin',
    });
    res.status(200).send(icon.body);
  } catch (error) {
    logger.warn(
      `[favicon] failed to serve ${domain}: ${error instanceof Error ? error.message : String(error)}`,
    );
    if (!res.headersSent) {
      sendNoIcon(res);
    }
  }
}
