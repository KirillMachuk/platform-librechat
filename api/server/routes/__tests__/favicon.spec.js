const jwt = require('jsonwebtoken');
const express = require('express');
const request = require('supertest');
const cookieParser = require('cookie-parser');

/**
 * The route's WIRING, which the unit tests behind it cannot see.
 *
 * `identifyFaviconReader` and `faviconLimiter` are tested on their own, and both
 * would stay green if either were dropped from `router.get` — while dropping the
 * first leaves every request unnamed, and express-rate-limit answers a missing key
 * by putting every caller in ONE shared bucket rather than by failing.
 *
 * Nothing here reaches the network: every request asks for a domain the handler
 * refuses before any fetch.
 */
describe('GET /api/favicon — the chain in front of the handler', () => {
  const USER_ID = '0123456789abcdef01234567';
  const SECRET = 'route-wiring-secret';
  let app;
  let originalSecret;
  let originalSharedLinks;

  beforeAll(() => {
    originalSecret = process.env.JWT_REFRESH_SECRET;
    originalSharedLinks = process.env.ALLOW_SHARED_LINKS;
    process.env.JWT_REFRESH_SECRET = SECRET;
    app = express();
    app.use(cookieParser());
    app.use('/api/favicon', require('~/server/routes/favicon'));
  });

  beforeEach(() => {
    delete process.env.ALLOW_SHARED_LINKS;
  });

  afterAll(() => {
    process.env.JWT_REFRESH_SECRET = originalSecret;
    process.env.ALLOW_SHARED_LINKS = originalSharedLinks;
  });

  const session = () => jwt.sign({ id: USER_ID }, SECRET, { expiresIn: '1h' });

  it('serves a reader with no session, so a shared conversation keeps its icons', async () => {
    /* A conversation opened through a share link carries no cookie. Refusing it left
     * every icon in a shared research answer a grey globe, for bytes that are a
     * public site's logo — for domains the shared page already lists in plain text.
     * `localhost` is refused by the handler before any fetch, so a 404 here means
     * the request travelled the whole chain rather than that the network answered. */
    const res = await request(app).get('/api/favicon?domain=localhost');

    expect(res.status).toBe(404);
    expect(res.headers['cache-control']).toBe('private, max-age=3600');
  });

  it('counts an unnamed reader against an address, not against everybody at once', async () => {
    /* Without a key of its own the anonymous half would share ONE bucket with every
     * other anonymous caller on earth, and the first busy shared link would spend it
     * for all of them. */
    const first = await request(app).get('/api/favicon?domain=localhost');
    const remaining = Number(first.headers['x-ratelimit-remaining']);

    const second = await request(app).get('/api/favicon?domain=localhost');

    expect(first.headers['x-ratelimit-limit']).toBe('1200');
    expect(Number(second.headers['x-ratelimit-remaining'])).toBe(remaining - 1);
  });

  it('refuses an unnamed reader when sharing is switched off', async () => {
    /* The door is open only because sharing is: with no public page to be on, an
     * anonymous caller has no business here. */
    process.env.ALLOW_SHARED_LINKS = 'false';

    const res = await request(app).get('/api/favicon?domain=localhost');

    expect(res.status).toBe(401);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('treats a forged session as no session, never as the user it names', async () => {
    /* Otherwise choosing a user id would be a way to mint a fresh bucket: the reply
     * must be counted against the address, exactly as an anonymous one is. */
    const anonymous = await request(app).get('/api/favicon?domain=localhost');
    const anonymousLeft = Number(anonymous.headers['x-ratelimit-remaining']);

    const forged = await request(app)
      .get('/api/favicon?domain=localhost')
      .set('Cookie', `refreshToken=${jwt.sign({ id: USER_ID }, 'someone-else')}`);

    expect(forged.status).toBe(404);
    expect(Number(forged.headers['x-ratelimit-remaining'])).toBe(anonymousLeft - 1);
  });

  it('lets a real session reach the handler, counted against the reader', async () => {
    const anonymous = await request(app).get('/api/favicon?domain=localhost');
    const anonymousLeft = Number(anonymous.headers['x-ratelimit-remaining']);

    const named = await request(app)
      .get('/api/favicon?domain=localhost')
      .set('Cookie', `refreshToken=${session()}`);

    expect(named.status).toBe(404);
    expect(named.headers['x-ratelimit-limit']).toBe('1200');
    /* A bucket of its own: the reader's count does not follow on from the address's. */
    expect(Number(named.headers['x-ratelimit-remaining'])).toBeGreaterThan(anonymousLeft - 1);
  });
});
