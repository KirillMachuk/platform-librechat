jest.mock('undici', () => ({
  ...jest.requireActual('undici'),
  fetch: jest.fn(),
}));

import jwt from 'jsonwebtoken';
import { fetch } from 'undici';
import type { NextFunction, Request, Response } from 'express';
import {
  identifyFaviconReader,
  faviconCache,
  publicFaviconCache,
  faviconHandler,
  createFaviconCache,
  faviconPrefetchPending,
  normalizeFaviconDomain,
  prefetchFavicons,
  resolveFavicon,
} from './favicon';

const mockFetch = jest.mocked(fetch);

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03]);
const GIF = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00]);
const HTML = Buffer.from('<!doctype html><title>Not found</title>');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');

type FakeResponse = { ok: boolean; body: ReadableStream<Uint8Array> | null };

function toParts(body: Buffer | Buffer[] | null): Buffer[] {
  if (body == null) {
    return [];
  }
  return Array.isArray(body) ? body : [body];
}

function upstreamAnswers(body: Buffer | Buffer[] | null, ok = true): FakeResponse {
  const parts = toParts(body);
  return {
    ok,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const part of parts) {
          controller.enqueue(new Uint8Array(part));
        }
        controller.close();
      },
    }),
  };
}

function answerWith(body: Buffer | Buffer[] | null, ok = true): void {
  mockFetch.mockImplementation(async () => upstreamAnswers(body, ok) as never);
}

function makeResponse() {
  const res = {
    locals: {} as Record<string, string>,
    set: jest.fn(),
    send: jest.fn(),
    end: jest.fn(),
    status: jest.fn(),
    headers: {} as Record<string, string>,
  };
  res.status.mockReturnValue(res);
  res.set.mockImplementation((name: string | Record<string, string>, value?: string) => {
    if (typeof name === 'string') {
      res.headers[name] = value as string;
    } else {
      Object.assign(res.headers, name);
    }
    return res;
  });
  return res;
}

beforeEach(async () => {
  /* Warming is process-wide background work, so it outlives the test that started
   * it. Waiting for quiet here is what keeps these tests independent of the order
   * they run in — and giving up LOUDLY is what keeps a leaked lane from turning
   * the rest of the file into a row of timeouts with no cause named. */
  let turns = 0;
  while (faviconPrefetchPending() > 0) {
    if (++turns > 5000) {
      throw new Error(
        `a previous test left ${faviconPrefetchPending()} warming task(s) running; ` +
          'it must release every fetch it blocked',
      );
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  faviconCache.clear();
  publicFaviconCache.clear();
  mockFetch.mockReset();
});

/** Yields the event loop until `predicate` holds; the assertion after it decides. */
async function until(predicate: () => boolean, turns = 5000): Promise<void> {
  for (let i = 0; i < turns && !predicate(); i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function yieldTurns(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

const askedDomains = () =>
  mockFetch.mock.calls.map(([url]) => new URL(String(url)).searchParams.get('domain'));

describe('prefetchFavicons — the icons are fetched before anyone waits for them', () => {
  it('warms the exact key the browser will ask for, `www.` and all', async () => {
    /* The client derives the key with `getCleanDomain`, whose `www.` test is
     * case-sensitive. Warming a different key warms nothing and says nothing —
     * every icon would still arrive, just as slowly as before. */
    answerWith(PNG);
    prefetchFavicons([
      'https://www.example.com/article?a=1',
      'https://WWW.Example.com/other',
      'https://sub.example.org:8443/x#frag',
    ]);

    await until(() => faviconCache.size === 3);
    expect(askedDomains().sort()).toEqual(['example.com', 'sub.example.org', 'www.example.com']);
  });

  it('leaves nothing for the reader to wait for', async () => {
    answerWith(PNG);
    prefetchFavicons(['https://www.example.com/a']);
    await until(() => faviconCache.size === 1);
    const afterWarming = mockFetch.mock.calls.length;

    const entry = await resolveFavicon('example.com');

    expect(entry.icon?.body.equals(PNG)).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(afterWarming);
  });

  it('returns without waiting for any of the fetching', () => {
    /* It is called on the path that streams the sources to the screen, so the
     * requests may leave immediately — but nothing may be awaited before the
     * sources themselves reach the reader. */
    answerWith(PNG);

    expect(prefetchFavicons(['https://example.com/a'])).toBeUndefined();

    expect(faviconCache.size).toBe(0);
    expect(faviconPrefetchPending()).toBeGreaterThan(0);
  });

  it('never has more than six requests outstanding', async () => {
    /* The gate opens for good rather than releasing one batch: a lane picks up its
     * next domain the instant the previous one settles, so releasing only what was
     * outstanding at that moment strands the lanes that start afterwards — and a
     * stranded lane is held for the life of the process, which every later test
     * then has to do without. */
    let active = 0;
    let peak = 0;
    let open = false;
    let waiting: Array<() => void> = [];
    mockFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          active += 1;
          peak = Math.max(peak, active);
          const finish = () => {
            active -= 1;
            resolve(upstreamAnswers(PNG) as never);
          };
          if (open) {
            finish();
          } else {
            waiting.push(finish);
          }
        }),
    );

    prefetchFavicons(Array.from({ length: 30 }, (_, i) => `https://site${i}.example/a`));
    await until(() => waiting.length >= 6);
    await yieldTurns(30);
    expect(peak).toBe(6);

    open = true;
    const outstanding = waiting;
    waiting = [];
    outstanding.forEach((finish) => finish());

    await until(() => faviconCache.size === 30);
    expect(faviconCache.size).toBe(30);
    expect(peak).toBe(6);
  });

  it('warms at most 64 domains from one result set', async () => {
    answerWith(PNG);
    prefetchFavicons(Array.from({ length: 200 }, (_, i) => `https://site${i}.example/a`));

    await until(() => faviconCache.size === 64);
    await yieldTurns(50);
    expect(faviconCache.size).toBe(64);
  });

  it('spends its budget on the sites it does not have, not the ones it does', async () => {
    /* The map of sources a request accumulates is dominated by sites seen before —
     * half of them, measured. If those counted against the cap, the ninth search of
     * a research run would spend the whole budget re-warming what is already held
     * and leave every new site cold, which is the one case this exists for. */
    answerWith(PNG);
    const held = Array.from({ length: 60 }, (_, i) => `https://held${i}.example/a`);
    prefetchFavicons(held);
    await until(() => faviconPrefetchPending() === 0);
    expect(faviconCache.size).toBe(60);
    const beforeSecondSearch = mockFetch.mock.calls.length;

    const fresh = Array.from({ length: 8 }, (_, i) => `https://fresh${i}.example/a`);
    prefetchFavicons([...held, ...fresh]);
    await until(() => faviconPrefetchPending() === 0);

    expect(faviconCache.size).toBe(68);
    expect(askedDomains().slice(beforeSecondSearch).sort()).toEqual(
      fresh.map((_, i) => `fresh${i}.example`).sort(),
    );
  });

  it('keeps the six-lane ceiling across searches that overlap', async () => {
    /* The ceiling is on the process, not the call: a research run issues a search
     * per sub-question and they land on top of each other. */
    let active = 0;
    let peak = 0;
    let open = false;
    const waiting: Array<() => void> = [];
    mockFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          active += 1;
          peak = Math.max(peak, active);
          const finish = () => {
            active -= 1;
            resolve(upstreamAnswers(PNG) as never);
          };
          if (open) {
            finish();
          } else {
            waiting.push(finish);
          }
        }),
    );

    for (let search = 0; search < 10; search++) {
      prefetchFavicons(Array.from({ length: 20 }, (_, i) => `https://s${search}d${i}.example/a`));
    }
    await until(() => waiting.length >= 6);
    await yieldTurns(30);
    expect(peak).toBe(6);

    open = true;
    waiting.splice(0).forEach((finish) => finish());
    await until(() => faviconPrefetchPending() === 0);
    expect(peak).toBe(6);
  });

  it('opens a lane for every domain of a small result, not half of them', async () => {
    /* A lane takes its domain off the queue the moment it starts, so a ceiling
     * re-read against the shrinking queue would start three lanes for six domains
     * and warm an ordinary search at half speed. */
    let active = 0;
    let peak = 0;
    const waiting: Array<() => void> = [];
    mockFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          active += 1;
          peak = Math.max(peak, active);
          waiting.push(() => {
            active -= 1;
            resolve(upstreamAnswers(PNG) as never);
          });
        }),
    );

    prefetchFavicons(Array.from({ length: 6 }, (_, i) => `https://small${i}.example/a`));
    await until(() => waiting.length >= 6);
    await yieldTurns(20);

    expect(peak).toBe(6);
    waiting.splice(0).forEach((finish) => finish());
    await until(() => faviconPrefetchPending() === 0);
  });

  it('does not re-fetch a domain already held', async () => {
    answerWith(PNG);
    await resolveFavicon('example.com');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    prefetchFavicons(['https://example.com/a', 'https://www.example.com/b']);
    await yieldTurns(50);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('queues a domain once, however many searches name it', async () => {
    /* One research run issues a search per sub-question and they name the same
     * authoritative sites over and over. Without the dedupe the backlog fills with
     * copies of them and pushes real work past its ceiling. */
    let open = false;
    const waiting: Array<() => void> = [];
    mockFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          const finish = () => resolve(upstreamAnswers(PNG) as never);
          if (open) {
            finish();
          } else {
            waiting.push(finish);
          }
        }),
    );

    const links = Array.from({ length: 10 }, (_, i) => `https://site${i}.example/a`);
    for (let i = 0; i < 60; i++) {
      prefetchFavicons(links);
    }
    await yieldTurns(20);

    /* Six in a lane and four still queued — not six hundred. */
    expect(faviconPrefetchPending()).toBeLessThanOrEqual(10);

    open = true;
    waiting.splice(0).forEach((finish) => finish());
    await until(() => faviconCache.size === 10);
    expect(faviconCache.size).toBe(10);
  });

  it('shrugs off links that are not sources, and never throws', async () => {
    answerWith(PNG);
    expect(() =>
      prefetchFavicons([
        'not a url',
        'https://localhost/secret',
        'https://10.0.0.5/x',
        'https://[::1]/x',
        '',
        'https://good.example/a',
      ]),
    ).not.toThrow();

    await until(() => faviconCache.size === 1);
    await yieldTurns(30);
    expect(askedDomains()).toEqual(['good.example']);
  });

  it('does nothing at all when a search returned no usable source', () => {
    answerWith(PNG);
    prefetchFavicons([]);
    prefetchFavicons(['https://localhost/x']);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('normalizeFaviconDomain — the parameter is untrusted content', () => {
  it('accepts an ordinary domain and lowercases it', () => {
    expect(normalizeFaviconDomain('example.com')).toBe('example.com');
    expect(normalizeFaviconDomain('EXAMPLE.COM')).toBe('example.com');
    expect(normalizeFaviconDomain('www.example.com')).toBe('www.example.com');
  });

  it('punycodes an international domain instead of rejecting it', () => {
    /* A regexp over ASCII labels would have quietly dropped every .рф source. */
    expect(normalizeFaviconDomain('пример.рф')).toBe('xn--e1afmkfd.xn--p1ai');
  });

  it('strips a smuggled path, port, credential, query or fragment', () => {
    expect(normalizeFaviconDomain('evil.com/../../etc/passwd')).toBe('evil.com');
    expect(normalizeFaviconDomain('evil.com:8080')).toBe('evil.com');
    expect(normalizeFaviconDomain('user:pass@evil.com')).toBe('evil.com');
    expect(normalizeFaviconDomain('evil.com?x=1')).toBe('evil.com');
    expect(normalizeFaviconDomain('evil.com#frag')).toBe('evil.com');
  });

  it.each([
    ['localhost', 'localhost'],
    ['a loopback literal', '127.0.0.1'],
    ['an IPv6 loopback', '[::1]'],
    ['a private address', '10.0.0.5'],
    ['the cloud metadata address', '169.254.169.254'],
    ['a compose service name', 'redis'],
    ['an internal TLD', 'vault.internal'],
    ['an mDNS name', 'printer.local'],
  ])('refuses %s', (_label, value) => {
    expect(normalizeFaviconDomain(value)).toBeNull();
  });

  it.each([
    ['an unparseable host', 'a b.com'],
    ['a percent escape', 'ex%2fample.com'],
    ['a single label', 'com'],
    ['a leading hyphen', '-bad.com'],
    ['a trailing hyphen', 'bad-.com'],
    ['an empty value', ''],
    ['an over-long value', `${'a'.repeat(250)}.com`],
  ])('refuses %s', (_label, value) => {
    expect(normalizeFaviconDomain(value)).toBeNull();
  });

  it('refuses anything that is not a string', () => {
    expect(normalizeFaviconDomain(undefined)).toBeNull();
    expect(normalizeFaviconDomain(['example.com'])).toBeNull();
    expect(normalizeFaviconDomain({ toString: () => 'example.com' })).toBeNull();
  });
});

describe('resolveFavicon — one upstream request per domain', () => {
  it('fetches on a miss and serves the second reader from cache', async () => {
    answerWith(PNG);

    const first = await resolveFavicon('example.com');
    expect(first.icon?.contentType).toBe('image/png');
    expect(first.icon?.body.equals(PNG)).toBe(true);

    const second = await resolveFavicon('example.com');
    expect(second.icon?.body.equals(PNG)).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('names the domain to upstream as a parameter, never as a destination', async () => {
    /* This is the invariant that lets the endpoint skip a DNS-resolving SSRF
     * check: the host is a constant and the domain only ever rides in the
     * query. Anything that makes the requested domain part of the destination
     * has to restore `resolveHostnameSSRF` — and turns this red first. */
    answerWith(PNG);
    for (const domain of ['example.com', 'xn--e1afmkfd.xn--p1ai', 'a-b.c-d.example']) {
      await resolveFavicon(domain);
    }

    for (const [url] of mockFetch.mock.calls) {
      const parsed = new URL(String(url));
      expect(parsed.origin).toBe('https://www.google.com');
      expect(parsed.pathname).toBe('/s2/favicons');
    }
    expect(String(mockFetch.mock.calls[0][0])).toBe(
      'https://www.google.com/s2/favicons?domain=example.com&sz=32',
    );
  });

  it('collapses a burst of concurrent readers into a single fetch', async () => {
    /* A message with twenty sources renders twenty images at once; on a cold
     * cache each one used to be its own outbound request. */
    answerWith(PNG);
    const results = await Promise.all(
      Array.from({ length: 20 }, () => resolveFavicon('example.com')),
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(results.every((entry) => entry.icon?.body.equals(PNG))).toBe(true);
  });

  it('remembers that upstream has no icon, and remembers it for less long', async () => {
    answerWith(null, false);
    const miss = await resolveFavicon('nothing.example');
    expect(miss.icon).toBeNull();

    await resolveFavicon('nothing.example');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    answerWith(PNG);
    const hit = await resolveFavicon('example.com');
    expect(hit.expiresAt).toBeGreaterThan(miss.expiresAt);
  });

  it('treats an oversized answer as no icon and stops reading it', async () => {
    const chunk = Buffer.alloc(8 * 1024, 0x89);
    let delivered = 0;
    mockFetch.mockImplementation(
      async () =>
        ({
          ok: true,
          body: new ReadableStream<Uint8Array>({
            pull(controller) {
              delivered += 1;
              controller.enqueue(new Uint8Array(chunk));
            },
          }),
        }) as never,
    );

    const entry = await resolveFavicon('huge.example');
    expect(entry.icon).toBeNull();
    /* The cap is 16KB: it must give up a few 8KB chunks in, not stream forever. */
    expect(delivered).toBeLessThan(8);
  });

  it.each([
    ['an error page served with 200', HTML],
    ['an SVG, which is a scriptable document', SVG],
    ['an empty body', Buffer.alloc(0)],
  ])('treats %s as no icon', async (_label, body) => {
    answerWith(body);
    const entry = await resolveFavicon('weird.example');
    expect(entry.icon).toBeNull();
  });

  it('labels the answer by its bytes, not by what upstream claims', async () => {
    answerWith(GIF);
    const entry = await resolveFavicon('gif.example');
    expect(entry.icon?.contentType).toBe('image/gif');
  });

  it('answers no icon when upstream fails outright', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    const entry = await resolveFavicon('down.example');
    expect(entry.icon).toBeNull();
  });
});

describe('the icon cache is bounded by bytes, not left to expire', () => {
  const entry = (bytes: number, expiresAt = Date.now() + 60_000) => ({
    icon: { body: Buffer.alloc(bytes), contentType: 'image/png' },
    expiresAt,
  });

  it('evicts the least recently used entry once the byte ceiling is passed', () => {
    const cache = createFaviconCache(3 * 1024);
    cache.set('a.com', entry(700));
    cache.set('b.com', entry(700));
    cache.set('c.com', entry(700));
    /* Touching `a` makes `b` the oldest. */
    expect(cache.get('a.com', Date.now())).toBeDefined();

    cache.set('d.com', entry(700));

    expect(cache.bytes).toBeLessThanOrEqual(3 * 1024);
    expect(cache.get('b.com', Date.now())).toBeUndefined();
    expect(cache.get('a.com', Date.now())).toBeDefined();
    expect(cache.get('d.com', Date.now())).toBeDefined();
  });

  it('stops accounting for an entry it replaces', () => {
    const cache = createFaviconCache(3 * 1024);
    cache.set('a.com', entry(700));
    const afterFirst = cache.bytes;
    cache.set('a.com', entry(700));

    expect(cache.size).toBe(1);
    expect(cache.bytes).toBe(afterFirst);
  });

  it('drops an entry that has expired instead of serving it', () => {
    const cache = createFaviconCache(3 * 1024);
    cache.set('a.com', entry(700, Date.now() - 1));

    expect(cache.get('a.com', Date.now())).toBeUndefined();
    expect(cache.size).toBe(0);
    expect(cache.bytes).toBe(0);
  });
});

describe('the two stores keep a stranger from timing what the client searched', () => {
  it('does not answer a stranger from the store warming fills', async () => {
    /* A cached icon comes back in ~4ms and an uncached one in ~200ms, and that gap
     * is legible from outside. Were the store shared, `?domain=<candidate>` would
     * answer whether this client's searches turned that site up lately — the very
     * leak this endpoint exists to close. */
    answerWith(PNG);
    await resolveFavicon('searched-by-the-client.example');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await resolveFavicon('searched-by-the-client.example', 'public');

    /* The stranger paid for their own fetch, so the answer took what a miss takes. */
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(publicFaviconCache.size).toBe(1);
  });

  it('does not let a stranger warm what the client reads either', async () => {
    answerWith(PNG);
    await resolveFavicon('opened-on-a-shared-page.example', 'public');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await resolveFavicon('opened-on-a-shared-page.example');

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('a stranger arriving mid-fetch does not join the fetch started for a reader', async () => {
    /* The stores have an in-flight map EACH, and this is the only test that can see
     * it: every other one waits for a fetch to finish before starting the next, so
     * one shared map would pass them all. Sharing it would put the stranger's
     * latency back on the reader's schedule — a narrow window, but the same leak in
     * miniature, and their answer would land in the wrong store besides. */
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    mockFetch.mockImplementation(async () => {
      await gate;
      return upstreamAnswers(PNG) as never;
    });

    const readerPending = resolveFavicon('being-warmed.example');
    await yieldTurns(1);
    const strangerPending = resolveFavicon('being-warmed.example', 'public');
    await yieldTurns(1);

    expect(mockFetch).toHaveBeenCalledTimes(2);

    release();
    await Promise.all([readerPending, strangerPending]);
    expect(faviconCache.size).toBe(1);
    expect(publicFaviconCache.size).toBe(1);
  });

  it('serves the second visitor to a shared page from the store the first one filled', async () => {
    answerWith(PNG);
    await resolveFavicon('shared.example', 'public');
    await resolveFavicon('shared.example', 'public');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(faviconCache.size).toBe(0);
  });

  it('gives the store behind share links a smaller budget than the one the client reads from', async () => {
    /* Same 300 icons into each: the public store has to start evicting where the
     * client's does not, or an anonymous flood is free to cost as much as the
     * client's own week of research. */
    answerWith(Buffer.concat([PNG, Buffer.alloc(8 * 1024)]));

    for (let i = 0; i < 300; i++) {
      await resolveFavicon(`flood${i}.example`, 'public');
    }
    expect(publicFaviconCache.size).toBeLessThan(300);

    for (let i = 0; i < 300; i++) {
      await resolveFavicon(`held${i}.example`);
    }
    expect(faviconCache.size).toBe(300);
  });

  it('warming never touches the store strangers are served from', async () => {
    answerWith(PNG);
    prefetchFavicons(['https://warmed.example/a']);
    await until(() => faviconPrefetchPending() === 0);

    expect(faviconCache.size).toBe(1);
    expect(publicFaviconCache.size).toBe(0);
  });
});

describe('identifyFaviconReader — the cookie names the reader, it does not admit them', () => {
  const USER_ID = '0123456789abcdef01234567';
  const SECRET = 'refresh-secret-for-tests';
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, JWT_REFRESH_SECRET: SECRET };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const run = (cookies: Record<string, string>) => {
    const res = makeResponse();
    const next = jest.fn() as NextFunction;
    identifyFaviconReader({ cookies } as unknown as Request, res as unknown as Response, next);
    return { res, next };
  };

  it('names the reader from a valid session, for the rate limiter to count against', () => {
    const token = jwt.sign({ id: USER_ID }, SECRET, { expiresIn: '1h' });
    const { res, next } = run({ refreshToken: token });

    expect(next).toHaveBeenCalled();
    expect(res.locals.userId).toBe(USER_ID);
  });

  it('accepts the OpenID session cookie too', () => {
    const token = jwt.sign({ id: USER_ID }, SECRET, { expiresIn: '1h' });
    const { res, next } = run({ openid_user_id: token });

    expect(next).toHaveBeenCalled();
    expect(res.locals.userId).toBe(USER_ID);
  });

  it.each([
    ['no cookie at all', {}],
    ['a garbage token', { refreshToken: 'not-a-jwt' }],
    ['a token signed with another secret', { refreshToken: jwt.sign({ id: USER_ID }, 'other') }],
    ['an expired token', { refreshToken: jwt.sign({ id: USER_ID }, SECRET, { expiresIn: -60 }) }],
    ['a payload without a user id', { refreshToken: jwt.sign({ sub: USER_ID }, SECRET) }],
    ['an id that is not a user id', { refreshToken: jwt.sign({ id: 'root' }, SECRET) }],
  ])('lets %s through unnamed, so the limiter falls back to the address', (_label, cookies) => {
    /* A conversation read through a share link has no cookie, and a cookie that does
     * not verify must buy nothing that no cookie would not — otherwise choosing a
     * user id would be a way to mint a bucket of one's own. */
    const { res, next } = run(cookies);

    expect(next).toHaveBeenCalled();
    expect(res.locals.userId).toBeUndefined();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('refuses an unnamed reader when sharing is switched off', () => {
    /* No public page to be on, no reason to be here. */
    process.env.ALLOW_SHARED_LINKS = 'false';
    const { res, next } = run({});

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.headers['Cache-Control']).toBe('no-store');
  });

  it('still names a signed-in reader when sharing is switched off', () => {
    process.env.ALLOW_SHARED_LINKS = 'false';
    const { res, next } = run({ refreshToken: jwt.sign({ id: USER_ID }, SECRET) });

    expect(next).toHaveBeenCalled();
    expect(res.locals.userId).toBe(USER_ID);
  });
});

describe('faviconHandler', () => {
  const call = async (domain: unknown, userId?: string) => {
    const res = makeResponse();
    if (userId) {
      res.locals.userId = userId;
    }
    await faviconHandler({ query: { domain } } as unknown as Request, res as unknown as Response);
    return res;
  };

  it('serves a reader the cookie named from the store warming fills', async () => {
    answerWith(PNG);

    await call('example.com', '0123456789abcdef01234567');

    expect(faviconCache.size).toBe(1);
    expect(publicFaviconCache.size).toBe(0);
  });

  it('serves a reader the cookie did not name from the store share links fill', async () => {
    /* This is the seam the whole separation rests on: get it backwards and a
     * stranger is timing the client's own cache again, with every test above still
     * green because they call `resolveFavicon` directly. */
    answerWith(PNG);

    await call('example.com');

    expect(publicFaviconCache.size).toBe(1);
    expect(faviconCache.size).toBe(0);
  });

  it('serves the icon with a type that matches its bytes and refuses sniffing', async () => {
    answerWith(PNG);
    const res = await call('example.com');

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith(PNG);
    expect(res.headers['Content-Type']).toBe('image/png');
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(res.headers['Content-Security-Policy']).toBe("default-src 'none'");
    expect(res.headers['Cache-Control']).toBe('private, max-age=86400');
  });

  it('answers a refused domain with the same "no icon" as an empty upstream, and never fetches', async () => {
    const res = await call('169.254.169.254');

    expect(res.status).toHaveBeenCalledWith(404);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(res.headers['Cache-Control']).toBe('private, max-age=3600');
  });

  it('answers "no icon" when upstream has none', async () => {
    answerWith(null, false);
    const res = await call('nothing.example');

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.headers['Cache-Control']).toBe('private, max-age=3600');
  });
});
