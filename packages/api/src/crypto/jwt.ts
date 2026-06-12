import jwt from 'jsonwebtoken';

/**
 * Generate a short-lived JWT token for internal RAG API calls (embed/query/text/delete).
 *
 * Default TTL is overridable via `RAG_JWT_TTL` (zeit/ms format, e.g. '30m'): when a large
 * scanned PDF waits in the parser queue plus OCR longer than the TTL, the subsequent
 * `/embed` call gets 401 from the RAG API and the upload is silently lost.
 * @param {String} userId - The ID of the user
 * @param {String} [expireIn] - The expiration time for the token (default `RAG_JWT_TTL` or 5 minutes)
 * @returns {String} - The generated JWT token
 */
export const generateShortLivedToken = (
  userId: string,
  expireIn: string = process.env.RAG_JWT_TTL || '5m',
): string => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET!, {
    expiresIn: expireIn,
    algorithm: 'HS256',
  });
};
