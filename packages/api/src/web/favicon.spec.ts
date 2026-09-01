jest.mock('undici', () => ({
  ...jest.requireActual('undici'),
  fetch: jest.fn(),
}));

import jwt from 'jsonwebtoken';
import { fetch } from 'undici';
import type { NextFunction, Request, Response } from 'express';
import {
  faviconAuth,
  faviconCache,
  faviconHandler,
  createFaviconCache,
  normalizeFaviconDomain,
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

beforeEach(() => {
  faviconCache.clear();
  mockFetch.mockReset();
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

describe('faviconAuth — an <img> proves itself with the session cookie', () => {
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
    faviconAuth({ cookies } as unknown as Request, res as unknown as Response, next);
    return { res, next };
  };

  it('lets a valid session through and names the user for the rate limiter', () => {
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
  ])('refuses %s', (_label, cookies) => {
    const { res, next } = run(cookies);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('faviconHandler', () => {
  const call = async (domain: unknown) => {
    const res = makeResponse();
    await faviconHandler({ query: { domain } } as unknown as Request, res as unknown as Response);
    return res;
  };

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
