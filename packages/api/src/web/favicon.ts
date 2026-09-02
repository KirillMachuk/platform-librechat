import jwt from 'jsonwebtoken';
import { isIP } from 'node:net';
import { fetch as undiciFetch } from 'undici';
import { logger } from '@librechat/data-schemas';
import type { RequestInit, Response as UndiciResponse } from 'undici';
import type { NextFunction, Request, Response } from 'express';
import { getEnvProxyDispatcher } from '~/utils/proxy';
import { isSSRFTarget } from '~/auth/domain';
import { isEnabled } from '~/utils';

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
 *
 * WARMING CHANGES THE SHAPE OF THAT RESIDUAL, and the change is a real one. Before
 * it, `loading="lazy"` meant a domain reached upstream only once a reader actually
 * put that source on screen — a collapsed list sent nothing. Warming names every
 * domain of every result set, including the ones nobody ever opens and the runs
 * that get cancelled. More domains, then; but no longer any signal about which of
 * them a person chose to read, which is the more telling half. Owner's call, made
 * knowingly 02.09.2026, not a detail of the implementation.
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

/**
 * The store behind share links gets a quarter of that. It is filled one icon at a
 * time by people opening shared pages rather than by warming, and keeping it small
 * bounds what an anonymous flood can cost: its own budget, never the client's.
 */
const PUBLIC_CACHE_BYTES = 2 * 1024 * 1024;

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

interface FaviconStore {
  cache: FaviconCache;
  /**
   * One upstream request per domain even when a message renders twenty icons at
   * once. Without this, opening a report with many sources on a cold cache would
   * fan out one outbound request per `<img>` rather than one per domain.
   */
  inFlight: Map<string, Promise<FaviconEntry>>;
}

function createFaviconStore(maxBytes: number): FaviconStore {
  return { cache: createFaviconCache(maxBytes), inFlight: new Map() };
}

/**
 * TWO stores, and the separation is the whole point.
 *
 * A cached icon comes back in about 4ms and an uncached one in about 200ms, and
 * that difference is legible from the outside. One shared store would therefore
 * answer a question nobody should be able to ask us: send `?domain=<candidate>`
 * and the response time says whether this client's searches turned that site up
 * lately. Warming makes it worse, not better — it fills the cache with every
 * domain of every result set, so a single store would be close to a week's index
 * of what the company has been reading. That is precisely the leak this endpoint
 * was built to close, and reopening it to anyone who can open a share link would
 * have undone the whole thing.
 *
 * So a reader with a session is served from the store that warming fills, and a
 * reader without one is served from a store that only ever holds what other
 * anonymous visitors have already asked for. Probing the second one reveals what
 * is on the shared pages people have opened — which is what a shared page is for.
 * The bytes are identical either way; only the timing is partitioned, because the
 * timing is the only thing that was leaking.
 *
 * The second store is also what keeps an anonymous flood from evicting the icons
 * the client's own answers depend on: the budgets are separate.
 */
const readerStore = createFaviconStore(MAX_CACHE_BYTES);
const publicStore = createFaviconStore(PUBLIC_CACHE_BYTES);

/** Who is asking. Anything a session did not name is `public`. */
export type FaviconAudience = 'reader' | 'public';

export const faviconCache = readerStore.cache;
export const publicFaviconCache = publicStore.cache;

export async function resolveFavicon(
  domain: string,
  audience: FaviconAudience = 'reader',
): Promise<FaviconEntry> {
  const { cache, inFlight } = audience === 'public' ? publicStore : readerStore;

  const cached = cache.get(domain, Date.now());
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
    cache.set(domain, entry);
    return entry;
  })().finally(() => inFlight.delete(domain));

  inFlight.set(domain, request);
  return request;
}

/**
 * How many source domains one search result is allowed to warm. Measured on live
 * data 02.09.2026: a conversation carries 10 sources at the median, and the
 * heaviest Deep Research answer carried 116. The cap is above the normal case and
 * below the pathological one — a result set larger than this is not a reading list.
 */
const PREFETCH_MAX_DOMAINS = 64;

/**
 * Warming lanes. Firing every domain at once is what we are avoiding: measured on
 * the stand, 109 icons requested simultaneously took 1365ms and each individual
 * request rose to a p50 of 1179ms through contention, against 87ms for the same
 * 109 served from cache. Six lanes clear a 64-domain result in about two seconds
 * of wall time, which the model spends writing anyway, without a burst.
 */
const PREFETCH_LANES = 6;

/**
 * The cache key the browser is going to ask for, derived from a source link.
 *
 * MIRRORS `getCleanDomain` in `client/src/components/Web/SourceHovercard.tsx`,
 * deliberately character for character — including that its `www.` test is
 * case-sensitive, so `WWW.Example.com` keeps its prefix on both sides. Warming a
 * key that differs from the one the browser requests warms nothing at all, and
 * does so silently: every icon would still arrive, just as slowly as before.
 */
function domainFromSourceLink(link: string): string | null {
  if (typeof link !== 'string') {
    return null;
  }
  const host = link.replace(/(^\w+:|^)\/\//, '').split('/')[0];
  return normalizeFaviconDomain(host.startsWith('www.') ? host.slice(4) : host);
}

/**
 * Domains waiting to be warmed, and the lanes draining them.
 *
 * The bound is deliberately on the PROCESS, not on the call: one Deep Research run
 * issues a search per sub-question, so a per-call limit of six would still let ten
 * overlapping searches open sixty sockets. Warming is background work — it must
 * never be able to crowd out the requests a reader is actually waiting on.
 */
const prefetchQueue: string[] = [];
const prefetchQueued = new Set<string>();
let prefetchLanes = 0;

/** A ceiling on the backlog itself, so a burst of searches cannot grow it without end. */
const PREFETCH_MAX_QUEUE = 512;

/**
 * Warming still outstanding, queued or in a lane. Exposed so that quiet can be
 * waited for rather than guessed at — by a test, or when diagnosing whether the
 * background work is keeping up with a long research run.
 */
export function faviconPrefetchPending(): number {
  return prefetchQueue.length + prefetchLanes;
}

async function drainPrefetchQueue(): Promise<void> {
  try {
    while (prefetchQueue.length > 0) {
      const domain = prefetchQueue.shift() as string;
      await resolveFavicon(domain).catch(() => undefined);
      prefetchQueued.delete(domain);
    }
  } finally {
    prefetchLanes -= 1;
  }
}

/**
 * Fetches the icons for a set of sources before anyone asks for them.
 *
 * The server learns which sites a search turned up strictly before the browser
 * does — this is called the moment results arrive, and the model then spends
 * seconds (a Deep Research run, minutes) writing the answer around them. Doing the
 * outbound work in that window is why this exists: it moves the cold fetch off the
 * reader's wait, and unlike the cache it helps even when every domain is new,
 * which in this client's data is 47% of them.
 *
 * Measured on the stand 02.09.2026: 109 icons asked for at once cost 1365ms cold
 * against 87ms warm, so this is worth about 1.3s on a heavy research answer.
 *
 * Returns immediately and never throws. Nothing downstream may wait on it: the
 * caller is on the path that streams the sources to the screen.
 */
export function prefetchFavicons(links: Iterable<string>): void {
  const now = Date.now();
  let added = 0;
  try {
    for (const link of links) {
      if (added >= PREFETCH_MAX_DOMAINS || prefetchQueue.length >= PREFETCH_MAX_QUEUE) {
        break;
      }
      const domain = domainFromSourceLink(link);
      /* A domain already held costs nothing to warm and must therefore cost
       * nothing from the budget either. The caller's list is dominated by the
       * sites this client returns to again and again — 53% of source references
       * measured over 39 days — and counting those would push the handful of new
       * ones, the only ones a reader waits for, past the cap. */
      if (!domain || prefetchQueued.has(domain) || faviconCache.get(domain, now)) {
        continue;
      }
      prefetchQueued.add(domain);
      prefetchQueue.push(domain);
      added += 1;
    }
  } catch {
    /* A source list that will not iterate is not a reason to lose the sources. */
  }

  if (added === 0) {
    return;
  }

  /* Fixed before the first lane starts: a lane shifts its domain off the queue
   * synchronously, so re-reading the length here would start half the lanes the
   * comment above promises (measured: three for six domains). */
  const lanes = Math.min(PREFETCH_LANES, prefetchQueue.length);
  while (prefetchLanes < lanes) {
    prefetchLanes += 1;
    /* A rejection here has nobody to catch it, and Node ends the process over an
     * unhandled one. Warming an icon must not be able to do that. */
    void drainPrefetchQueue().catch(() => undefined);
  }
  /* At info, not debug: the whole point of warming is that nobody sees it happen,
   * so without a line in the log there is no way to tell a working rollout from a
   * silently dead one, and the stand runs with debug off. */
  logger.info(`[favicon] warming ${added} source domain(s) ahead of the reader`);
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
 * Names the reader from the session cookie rather than the `Authorization` header,
 * and does not insist on finding one.
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
 * WHY A MISSING COOKIE IS NOT REFUSED. A conversation shared by link is read
 * without signing in, so demanding a session left every icon in a shared research
 * answer a grey globe. What these bytes are decides it: a public site's logo, for
 * domains the shared page already lists beside them in plain text — serving them
 * discloses nothing the reader is not already looking at. What keeps the endpoint
 * narrow was never the cookie: one upstream host that is a constant, a domain that
 * is only ever a query parameter, 16KB apiece, a cache with a fixed ceiling, and
 * for a caller who proves nothing, a limit counted per address.
 *
 * A cookie that does not verify is treated as no cookie at all, never as the user
 * it names — otherwise choosing a user id would be a way to mint a fresh bucket.
 *
 * The door is open only because sharing is: with `ALLOW_SHARED_LINKS` switched off
 * there is no page an anonymous reader could legitimately be on, and the request is
 * refused as before. Mirrors `api/server/routes/share.js`, where that flag decides
 * whether the public route exists at all.
 *
 * Must be mounted after `cookieParser`.
 */
export function identifyFaviconReader(req: Request, res: Response, next: NextFunction): void {
  const userId = cookieUserId(req);
  if (userId) {
    res.locals.userId = userId;
    next();
    return;
  }
  if (process.env.ALLOW_SHARED_LINKS !== undefined && !isEnabled(process.env.ALLOW_SHARED_LINKS)) {
    res.set('Cache-Control', 'no-store');
    res.status(401).end();
    return;
  }
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

  /* A reader the cookie did not name is served from the store share links fill, so
   * that the time this answer takes says nothing about what the client searched. */
  const audience: FaviconAudience = res.locals.userId ? 'reader' : 'public';

  try {
    const { icon } = await resolveFavicon(domain, audience);
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
