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
    /* Without this every request arrives from 127.0.0.1 and the address key is a
     * constant — which is exactly the bug the tests below have to be able to see. */
    app.set('trust proxy', 1);
    app.use(cookieParser());
    app.use('/api/favicon', require('~/server/routes/favicon'));
  });

  beforeEach(() => {
    delete process.env.ALLOW_SHARED_LINKS;
  });

  afterAll(() => {
    /* Assigning an absent value back writes the STRING "undefined" — the trap that
     * leaves the next file reading a flag that looks set. */
    restore('JWT_REFRESH_SECRET', originalSecret);
    restore('ALLOW_SHARED_LINKS', originalSharedLinks);
  });

  const restore = (name, value) => {
    if (value === undefined) {
      delete process.env[name];
      return;
    }
    process.env[name] = value;
  };

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

  it('counts an unnamed reader against their own address, not against everybody at once', async () => {
    /* Without a key of its own the anonymous half would share ONE bucket with every
     * other anonymous caller on earth, and the first busy shared link would spend it
     * for all of them. Two DIFFERENT addresses is what proves it: a shared bucket
     * would have the second one continue the first one's count. */
    const fromOne = await request(app)
      .get('/api/favicon?domain=localhost')
      .set('X-Forwarded-For', '203.0.113.7');
    const againFromOne = await request(app)
      .get('/api/favicon?domain=localhost')
      .set('X-Forwarded-For', '203.0.113.7');
    const fromAnother = await request(app)
      .get('/api/favicon?domain=localhost')
      .set('X-Forwarded-For', '198.51.100.9');

    expect(fromOne.headers['x-ratelimit-limit']).toBe('1200');
    expect(Number(againFromOne.headers['x-ratelimit-remaining'])).toBe(
      Number(fromOne.headers['x-ratelimit-remaining']) - 1,
    );
    /* A bucket of its own: the newcomer starts where the first address started. */
    expect(Number(fromAnother.headers['x-ratelimit-remaining'])).toBe(
      Number(fromOne.headers['x-ratelimit-remaining']),
    );
  });

  it('gives one IPv6 client one bucket, not one per address it holds', async () => {
    /* A client is handed a /64; without the library's own masking each address in
     * it is a key of its own and the limit stops existing. Nothing else can see
     * this: every other test here speaks IPv4, and express-rate-limit's own guard
     * is blind to it because `removePorts` reads `req['ip']` in brackets on
     * purpose, which is exactly what its heuristic scans for. */
    const first = await request(app)
      .get('/api/favicon?domain=localhost')
      .set('X-Forwarded-For', '2001:db8:1234:5678::1');
    const neighbour = await request(app)
      .get('/api/favicon?domain=localhost')
      .set('X-Forwarded-For', '2001:db8:1234:5678::99ff');

    expect(Number(neighbour.headers['x-ratelimit-remaining'])).toBe(
      Number(first.headers['x-ratelimit-remaining']) - 1,
    );
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
    const anonymous = await request(app)
      .get('/api/favicon?domain=localhost')
      .set('X-Forwarded-For', '203.0.113.44');
    const anonymousLeft = Number(anonymous.headers['x-ratelimit-remaining']);

    const forged = await request(app)
      .get('/api/favicon?domain=localhost')
      .set('X-Forwarded-For', '203.0.113.44')
      .set('Cookie', `refreshToken=${jwt.sign({ id: USER_ID }, 'someone-else')}`);

    expect(forged.status).toBe(404);
    expect(Number(forged.headers['x-ratelimit-remaining'])).toBe(anonymousLeft - 1);
  });

  it('lets a real session reach the handler, counted against the reader', async () => {
    const anonymous = await request(app)
      .get('/api/favicon?domain=localhost')
      .set('X-Forwarded-For', '203.0.113.55');
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
