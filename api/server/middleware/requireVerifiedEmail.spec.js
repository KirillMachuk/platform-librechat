const mockCheckEmailConfig = jest.fn();
jest.mock('@librechat/api', () => ({ checkEmailConfig: () => mockCheckEmailConfig() }));
jest.mock('@librechat/data-schemas', () => ({ logger: { warn: jest.fn() } }));

const requireVerifiedEmail = require('./requireVerifiedEmail');

function run(user, emailConfigured) {
  mockCheckEmailConfig.mockReturnValue(emailConfigured);
  const req = { user };
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  const next = jest.fn();
  requireVerifiedEmail(req, res, next);
  return { res, next };
}

describe('requireVerifiedEmail (C-AUTH-8)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is a no-op when email is not configured (self-hosted / no SMTP)', () => {
    const { next, res } = run({ id: 'u1', emailVerified: false }, false);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });

  it('allows a verified user when email is configured', () => {
    const { next } = run({ id: 'u1', emailVerified: true }, true);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('blocks an unverified user with 403 when email is configured', () => {
    const { next, res } = run({ id: 'u1', emailVerified: false }, true);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.message).toMatch(/verify your email/i);
  });
});
