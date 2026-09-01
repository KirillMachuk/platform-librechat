const jwt = require('jsonwebtoken');
const express = require('express');
const request = require('supertest');
const cookieParser = require('cookie-parser');

/**
 * The route's WIRING, which the unit tests behind it cannot see.
 *
 * `faviconAuth` and `faviconLimiter` are tested on their own, and both would stay
 * green if either were dropped from `router.get` — while dropping the first turns
 * this into an icon proxy open to the internet, and express-rate-limit answers a
 * missing key by putting every caller in ONE shared bucket rather than by failing.
 *
 * Nothing here reaches the network: an unauthenticated request never gets to the
 * handler, and the authenticated ones ask for domains the handler refuses before
 * any fetch.
 */
describe('GET /api/favicon — the chain in front of the handler', () => {
  const USER_ID = '0123456789abcdef01234567';
  const SECRET = 'route-wiring-secret';
  let app;
  let originalSecret;

  beforeAll(() => {
    originalSecret = process.env.JWT_REFRESH_SECRET;
    process.env.JWT_REFRESH_SECRET = SECRET;
    app = express();
    app.use(cookieParser());
    app.use('/api/favicon', require('~/server/routes/favicon'));
  });

  afterAll(() => {
    process.env.JWT_REFRESH_SECRET = originalSecret;
  });

  const session = () => jwt.sign({ id: USER_ID }, SECRET, { expiresIn: '1h' });

  it('refuses a request with no session, so the endpoint is not an open proxy', async () => {
    const res = await request(app).get('/api/favicon?domain=example.com');

    expect(res.status).toBe(401);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('refuses a session signed with another secret', async () => {
    const res = await request(app)
      .get('/api/favicon?domain=example.com')
      .set('Cookie', `refreshToken=${jwt.sign({ id: USER_ID }, 'someone-else')}`);

    expect(res.status).toBe(401);
  });

  it('lets a real session reach the handler', async () => {
    /* `localhost` is refused by the handler before any fetch, so a 404 here means
     * the request travelled the whole chain rather than that the network answered. */
    const res = await request(app)
      .get('/api/favicon?domain=localhost')
      .set('Cookie', `refreshToken=${session()}`);

    expect(res.status).toBe(404);
    expect(res.headers['cache-control']).toBe('private, max-age=3600');
  });

  it('counts the request against a per-reader ceiling', async () => {
    const res = await request(app)
      .get('/api/favicon?domain=localhost')
      .set('Cookie', `refreshToken=${session()}`);

    expect(res.headers['x-ratelimit-limit']).toBe('1200');
    expect(Number(res.headers['x-ratelimit-remaining'])).toBeLessThan(1200);
  });
});
