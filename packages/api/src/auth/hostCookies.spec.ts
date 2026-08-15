import express from 'express';
import request from 'supertest';
import type { NextFunction, Request, Response } from 'express';
import {
  hostLockedCookies,
  rewriteIncomingCookieHeader,
  ssoSessionCookieName,
  HOST_PREFIX,
} from './hostCookies';

/**
 * Reads the rewritten header the way a handler would, and throws if a name
 * survives twice. Asserting the single-candidate property directly is stronger
 * than asserting through one parser: whether the code downstream keeps the first
 * duplicate or the last stops mattering when only one ever arrives.
 */
const readHeader = (header: string | undefined): Record<string, string> => {
  const seen: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    const name = eq === -1 ? trimmed : trimmed.slice(0, eq);
    if (name in seen) {
      throw new Error(`duplicate cookie "${name}" survived the rewrite`);
    }
    seen[name] = eq === -1 ? '' : decodeURIComponent(trimmed.slice(eq + 1));
  }
  return seen;
};

const asHandlerSees = (header: string | undefined): Record<string, string> =>
  readHeader(rewriteIncomingCookieHeader(header));

describe('rewriteIncomingCookieHeader', () => {
  it('defeats the tossed cookie a neighbouring subdomain can plant', () => {
    /**
     * The attack: a sibling host writes `refreshToken` with `Domain=<site>` and a
     * longer `Path`, so the browser sends it FIRST and the parser on the request
     * path — which keeps the first occurrence — hands the server the attacker's
     * session. Measured on the live stand before this existed: a cookie set on the
     * bundler host arrived at the app host.
     */
    const header = `refreshToken=ATTACKER; ${HOST_PREFIX}refreshToken=VICTIM`;

    expect(asHandlerSees(header).refreshToken).toBe('VICTIM');
  });

  it('drops an un-prefixed auth cookie even when no genuine one is present', () => {
    /**
     * A fresh browser has nothing to overwrite, so the planted cookie would arrive
     * alone — session fixation without a duplicate in sight. Dropping unconditionally
     * is what covers that; preferring the prefixed one would not.
     */
    expect(asHandlerSees('refreshToken=ATTACKER').refreshToken).toBeUndefined();
    expect(asHandlerSees('token_provider=openid').token_provider).toBeUndefined();
  });

  it('drops a planted name padded with whitespace before the equals sign', () => {
    /**
     * The `cookie` package trims the optional whitespace around `=`, so
     * `refreshToken =x` reaches every handler as plain `refreshToken`. Matching
     * the untrimmed substring let exactly that spelling walk past the drop rule.
     */
    expect(asHandlerSees('refreshToken =ATTACKER; theme=dark').refreshToken).toBeUndefined();
    expect(asHandlerSees('refreshToken\t=ATTACKER').refreshToken).toBeUndefined();
    expect(asHandlerSees('refreshToken =ATTACKER; theme=dark').theme).toBe('dark');
  });

  it('leaves the SSO session cookie alone — express-session matches the wire name itself', () => {
    /**
     * The five auth cookies are unwrapped because the app code reads short names.
     * `express-session` is different: it is told the prefixed name and parses the
     * raw header itself, so unwrapping would hide the cookie from the only reader
     * there is.
     */
    const header = `${HOST_PREFIX}connect.sid=S; ${HOST_PREFIX}refreshToken=R`;
    expect(rewriteIncomingCookieHeader(header)).toContain(`${HOST_PREFIX}connect.sid=S`);
  });

  it('unwraps every locked cookie and leaves the rest of the header intact', () => {
    const parsed = asHandlerSees(
      `theme=dark; ${HOST_PREFIX}refreshToken=R; ${HOST_PREFIX}token_provider=librechat; lang=ru`,
    );

    expect(parsed.refreshToken).toBe('R');
    expect(parsed.token_provider).toBe('librechat');
    expect(parsed.theme).toBe('dark');
    expect(parsed.lang).toBe('ru');
  });

  it('leaves a header with nothing to lock exactly as it was', () => {
    const header = 'theme=dark; lang=ru';
    expect(rewriteIncomingCookieHeader(header)).toBe(header);
    expect(rewriteIncomingCookieHeader(undefined)).toBeUndefined();
  });

  it('keeps a value that itself contains the prefix from confusing the split', () => {
    const parsed = asHandlerSees(
      `${HOST_PREFIX}token_provider=openid; note=__Host-refreshToken%3Dx`,
    );
    expect(parsed.token_provider).toBe('openid');
    expect(parsed.note).toBe('__Host-refreshToken=x');
  });
});

describe('hostLockedCookies middleware', () => {
  const secureBefore = process.env.SESSION_COOKIE_SECURE;
  afterEach(() => {
    if (secureBefore === undefined) {
      delete process.env.SESSION_COOKIE_SECURE;
    } else {
      process.env.SESSION_COOKIE_SECURE = secureBefore;
    }
  });

  const run = (header?: string) => {
    const written: Array<{ name: string; value: string; options?: Record<string, unknown> }> = [];
    const req = { headers: header ? { cookie: header } : {} } as unknown as Request;
    const res = {
      cookie(name: string, value: string, options?: Record<string, unknown>) {
        written.push({ name, value, options });
        return this as unknown as Response;
      },
      clearCookie(name: string, options?: Record<string, unknown>) {
        written.push({ name, value: '', options });
        return this as unknown as Response;
      },
    } as unknown as Response;
    let called = false;
    hostLockedCookies(req, res, (() => {
      called = true;
    }) as NextFunction);
    return { req, res, written, called };
  };

  it('writes an auth cookie under the prefix, Secure and rooted at /', () => {
    process.env.SESSION_COOKIE_SECURE = 'true';
    const { res, written } = run();

    res.cookie('refreshToken', 'R', { httpOnly: true, sameSite: 'strict', domain: '.example.com' });

    expect(written).toHaveLength(1);
    expect(written[0].name).toBe(`${HOST_PREFIX}refreshToken`);
    expect(written[0].options).toMatchObject({ secure: true, path: '/', httpOnly: true });
    /** A `Domain` of any kind makes the browser reject a `__Host-` cookie outright. */
    expect(written[0].options).not.toHaveProperty('domain');
  });

  it('does not touch cookies that are not auth cookies', () => {
    process.env.SESSION_COOKIE_SECURE = 'true';
    const { res, written } = run();

    res.cookie('theme', 'dark', { httpOnly: false });

    expect(written[0].name).toBe('theme');
    expect(written[0].options).toEqual({ httpOnly: false });
  });

  it('clears both spellings so a pre-prefix session cannot linger unusable', () => {
    process.env.SESSION_COOKIE_SECURE = 'true';
    const { res, written } = run();

    res.clearCookie('refreshToken');

    expect(written.map((w) => w.name)).toEqual(['refreshToken', `${HOST_PREFIX}refreshToken`]);
  });

  it('stays out of the way without HTTPS, where a __Host- cookie would be refused', () => {
    /**
     * Localhost and the mock e2e profile serve over plain http. A browser rejects
     * `__Host-` there, so switching this on would not harden anything — it would
     * make signing in impossible.
     */
    process.env.SESSION_COOKIE_SECURE = 'false';
    const { req, res, written, called } = run('refreshToken=R');

    res.cookie('refreshToken', 'R', { httpOnly: true });

    expect(called).toBe(true);
    expect(req.headers.cookie).toBe('refreshToken=R');
    expect(written[0].name).toBe('refreshToken');
  });

  it('rewrites the request header before any handler parses it', () => {
    process.env.SESSION_COOKIE_SECURE = 'true';
    const { req } = run(`refreshToken=ATTACKER; ${HOST_PREFIX}refreshToken=VICTIM; theme=dark`);

    expect(readHeader(req.headers.cookie)).toMatchObject({
      refreshToken: 'VICTIM',
      theme: 'dark',
    });
  });
});

/**
 * The cases above drive a stand-in `res`. These drive a real Express app, because
 * the thing that actually has to be right is the serialised `Set-Cookie` line: a
 * browser silently ignores a `__Host-` cookie that carries a `Domain` or a path
 * other than `/`, and "silently ignored" here means nobody can sign in.
 */
describe('hostLockedCookies in a real Express app', () => {
  const secureBefore = process.env.SESSION_COOKIE_SECURE;
  beforeAll(() => {
    process.env.SESSION_COOKIE_SECURE = 'true';
  });
  afterAll(() => {
    if (secureBefore === undefined) {
      delete process.env.SESSION_COOKIE_SECURE;
    } else {
      process.env.SESSION_COOKIE_SECURE = secureBefore;
    }
  });

  const app = () => {
    const instance = express();
    instance.use(hostLockedCookies);
    instance.get('/set', (_req: Request, res: Response) => {
      res.cookie('refreshToken', 'R', { httpOnly: true, sameSite: 'strict', expires: new Date(0) });
      res.cookie('theme', 'dark');
      res.status(204).end();
    });
    instance.get('/logout', (_req: Request, res: Response) => {
      res.clearCookie('refreshToken');
      res.status(204).end();
    });
    instance.get('/read', (req: Request, res: Response) => {
      res.json({ cookie: req.headers.cookie ?? null });
    });
    return instance;
  };

  it('serialises a Set-Cookie a browser will accept as __Host-', async () => {
    const response = await request(app()).get('/set');
    /** supertest types the header bag as strings; `set-cookie` is the one that is a list. */
    const setCookie = response.headers['set-cookie'] as unknown as string[];

    const locked = setCookie.find((line) => line.startsWith(`${HOST_PREFIX}refreshToken=`));
    expect(locked).toBeDefined();
    expect(locked).toContain('Path=/');
    expect(locked).toContain('Secure');
    expect(locked).toContain('HttpOnly');
    /** Either attribute makes the browser drop the cookie on the floor. */
    expect(locked).not.toMatch(/Domain=/i);

    /** An untouched cookie keeps travelling under its own name. */
    expect(setCookie.some((line) => line.startsWith('theme=dark'))).toBe(true);
  });

  it('hands the handler the genuine cookie when a tossed one rides along', async () => {
    const response = await request(app())
      .get('/read')
      .set('Cookie', `refreshToken=ATTACKER; ${HOST_PREFIX}refreshToken=VICTIM; theme=dark`);

    expect(response.body.cookie).toBe('refreshToken=VICTIM; theme=dark');
  });

  it('expires BOTH spellings on logout, so nothing is left un-clearable', async () => {
    /**
     * The stand-in `res` above cannot catch this: Express implements `clearCookie`
     * in terms of `res.cookie`, so clearing the legacy name re-entered the
     * prefixing branch and emitted `__Host-` twice while the pre-rollout cookie was
     * never touched. Only a real Express app shows it.
     */
    const response = await request(app()).get('/logout');
    const setCookie = response.headers['set-cookie'] as unknown as string[];
    const expired = setCookie.filter((line) => /Expires=Thu, 01 Jan 1970/.test(line));

    expect(expired.some((line) => line.startsWith('refreshToken='))).toBe(true);
    expect(expired.some((line) => line.startsWith(`${HOST_PREFIX}refreshToken=`))).toBe(true);
  });
});

describe('ssoSessionCookieName', () => {
  const before = process.env.SESSION_COOKIE_SECURE;
  afterEach(() => {
    if (before === undefined) {
      delete process.env.SESSION_COOKIE_SECURE;
    } else {
      process.env.SESSION_COOKIE_SECURE = before;
    }
  });

  it('is prefixed under HTTPS, so a neighbour cannot plant an SSO session', () => {
    process.env.SESSION_COOKIE_SECURE = 'true';
    expect(ssoSessionCookieName()).toBe(`${HOST_PREFIX}connect.sid`);
  });

  it('keeps the plain name without HTTPS, where the prefixed one would be refused', () => {
    process.env.SESSION_COOKIE_SECURE = 'false';
    expect(ssoSessionCookieName()).toBe('connect.sid');
  });
});
