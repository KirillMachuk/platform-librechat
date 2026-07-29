import { logger } from '@librechat/data-schemas';
import type { Request, Response } from 'express';
import type { Types } from 'mongoose';

export interface ApiKeyHandlerDependencies {
  createAgentApiKey: (params: {
    userId: string | Types.ObjectId;
    name: string;
    expiresAt?: Date | null;
  }) => Promise<{
    id: string;
    name: string;
    key: string;
    keyPrefix: string;
    createdAt: Date;
    expiresAt?: Date;
  }>;
  listAgentApiKeys: (userId: string | Types.ObjectId) => Promise<
    Array<{
      id: string;
      name: string;
      keyPrefix: string;
      lastUsedAt?: Date;
      expiresAt?: Date;
      createdAt: Date;
    }>
  >;
  deleteAgentApiKey: (
    keyId: string | Types.ObjectId,
    userId: string | Types.ObjectId,
  ) => Promise<boolean>;
  getAgentApiKeyById: (
    keyId: string | Types.ObjectId,
    userId: string | Types.ObjectId,
  ) => Promise<{
    id: string;
    name: string;
    keyPrefix: string;
    lastUsedAt?: Date;
    expiresAt?: Date;
    createdAt: Date;
  } | null>;
}

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    _id: Types.ObjectId;
  };
  /** Read by the audit hook once the response settles — see `auditApiKey`. */
  auditApiKeyId?: string;
}

/**
 * Ceiling on how long a minted key stays valid. An API key reaches agents from
 * outside the UI with no session to expire, and the field is client-supplied
 * and optional — so "no expiry" used to mean "forever", and a key leaked from a
 * laptop stayed good indefinitely. A year is long enough not to interrupt
 * automation and short enough that a forgotten key eventually stops working.
 */
const MAX_API_KEY_TTL_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Resolves the client-supplied expiry against the ceiling.
 * @returns the effective expiry, or an error message when the input is unusable.
 */
export function resolveApiKeyExpiry(
  expiresAt: unknown,
  now: number,
): { expiresAt: Date } | { error: string } {
  const ceiling = new Date(now + MAX_API_KEY_TTL_MS);
  if (expiresAt == null || expiresAt === '') {
    return { expiresAt: ceiling };
  }
  if (typeof expiresAt !== 'string' && typeof expiresAt !== 'number') {
    return { error: 'expiresAt must be a date' };
  }
  const requested = new Date(expiresAt);
  if (Number.isNaN(requested.getTime())) {
    return { error: 'expiresAt must be a valid date' };
  }
  if (requested.getTime() <= now) {
    return { error: 'expiresAt must be in the future' };
  }
  return { expiresAt: requested.getTime() > ceiling.getTime() ? ceiling : requested };
}

export function createApiKeyHandlers(deps: ApiKeyHandlerDependencies): {
  createApiKey: (req: AuthenticatedRequest, res: Response) => Promise<Response | undefined>;
  listApiKeys: (req: AuthenticatedRequest, res: Response) => Promise<void>;
  getApiKey: (req: AuthenticatedRequest, res: Response) => Promise<Response | undefined>;
  deleteApiKey: (req: AuthenticatedRequest, res: Response) => Promise<Response | undefined>;
} {
  async function createApiKey(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<Response | undefined> {
    try {
      const { name, expiresAt } = req.body;

      if (!name || typeof name !== 'string' || name.trim() === '') {
        return res.status(400).json({
          error: 'API key name is required',
        });
      }

      const expiry = resolveApiKeyExpiry(expiresAt, Date.now());
      if ('error' in expiry) {
        return res.status(400).json({ error: expiry.error });
      }

      const result = await deps.createAgentApiKey({
        userId: req.user?.id || '',
        name: name.trim(),
        expiresAt: expiry.expiresAt,
      });

      /** So the audit entry names the key that was minted, not just its label. */
      req.auditApiKeyId = result.id;

      res.status(201).json({
        id: result.id,
        name: result.name,
        key: result.key,
        keyPrefix: result.keyPrefix,
        createdAt: result.createdAt,
        expiresAt: result.expiresAt,
      });
    } catch (error) {
      logger.error('[createApiKey] Error creating API key:', error);
      res.status(500).json({ error: 'Failed to create API key' });
    }
  }

  async function listApiKeys(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const keys = await deps.listAgentApiKeys(req.user?.id || '');
      res.status(200).json({ keys });
    } catch (error) {
      logger.error('[listApiKeys] Error listing API keys:', error);
      res.status(500).json({ error: 'Failed to list API keys' });
    }
  }

  async function getApiKey(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<Response | undefined> {
    try {
      const key = await deps.getAgentApiKeyById(req.params.id, req.user?.id || '');

      if (!key) {
        return res.status(404).json({ error: 'API key not found' });
      }

      res.status(200).json(key);
    } catch (error) {
      logger.error('[getApiKey] Error getting API key:', error);
      res.status(500).json({ error: 'Failed to get API key' });
    }
  }

  async function deleteApiKey(
    req: AuthenticatedRequest,
    res: Response,
  ): Promise<Response | undefined> {
    try {
      const deleted = await deps.deleteAgentApiKey(req.params.id, req.user?.id || '');

      if (!deleted) {
        return res.status(404).json({ error: 'API key not found' });
      }

      res.status(204).send();
    } catch (error) {
      logger.error('[deleteApiKey] Error deleting API key:', error);
      res.status(500).json({ error: 'Failed to delete API key' });
    }
  }

  return {
    createApiKey,
    listApiKeys,
    getApiKey,
    deleteApiKey,
  };
}
