import jwt from 'jsonwebtoken';
import { generateShortLivedToken } from './jwt';

describe('generateShortLivedToken', () => {
  const userId = 'user-123';

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret';
    delete process.env.RAG_JWT_TTL;
  });

  const decode = (token: string) => jwt.verify(token, 'test-secret') as jwt.JwtPayload;

  it('defaults to 5 minutes', () => {
    const payload = decode(generateShortLivedToken(userId));
    expect(payload.id).toBe(userId);
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(5 * 60);
  });

  it('respects RAG_JWT_TTL env override', () => {
    process.env.RAG_JWT_TTL = '30m';
    const payload = decode(generateShortLivedToken(userId));
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(30 * 60);
  });

  it('explicit expireIn argument wins over env', () => {
    process.env.RAG_JWT_TTL = '30m';
    const payload = decode(generateShortLivedToken(userId, '2m'));
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(2 * 60);
  });
});
