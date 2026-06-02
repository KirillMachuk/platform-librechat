import { REFILL_INTERVAL_UNITS } from 'librechat-data-provider';
import { logger, isValidObjectIdString } from '@librechat/data-schemas';
import type { RefillIntervalUnit } from 'librechat-data-provider';
import type { IUser, IBalance, IBalanceUpdate, AdminUserBalance } from '@librechat/data-schemas';
import type { FilterQuery } from 'mongoose';
import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';

/** Conversion rate between the canonical balance unit and USD: 1,000,000 credits = $1. */
export const TOKEN_CREDITS_PER_USD = 1_000_000;

/** Upper bound on ids accepted by the bulk balance endpoint (matches the user-list page cap). */
const MAX_BULK_IDS = 200;

const REFILL_UNITS: ReadonlySet<string> = new Set(REFILL_INTERVAL_UNITS);

export interface AdminBalanceDeps {
  findUser: (
    searchCriteria: FilterQuery<IUser>,
    fieldsToSelect?: string | string[] | null,
  ) => Promise<IUser | null>;
  findBalanceByUser: (user: string) => Promise<IBalance | null>;
  findBalancesByUsers: (users: string[]) => Promise<IBalance[]>;
  upsertBalanceFields: (user: string, fields: IBalanceUpdate) => Promise<IBalance | null>;
}

/** Maps a balance document (or its absence) to the serializable admin response shape. */
function mapBalance(userId: string, balance: IBalance | null): AdminUserBalance {
  const tokenCredits = balance?.tokenCredits ?? 0;
  return {
    userId,
    tokenCredits,
    balanceUsd: tokenCredits / TOKEN_CREDITS_PER_USD,
    autoRefillEnabled: balance?.autoRefillEnabled ?? false,
    refillIntervalValue: balance?.refillIntervalValue ?? 30,
    refillIntervalUnit: (balance?.refillIntervalUnit ?? 'days') as RefillIntervalUnit,
    refillAmount: balance?.refillAmount ?? 0,
    lastRefill: balance?.lastRefill ? new Date(balance.lastRefill).toISOString() : undefined,
  };
}

interface BalancePatchBody {
  tokenCredits?: number;
  autoRefillEnabled?: boolean;
  refillIntervalValue?: number;
  refillIntervalUnit?: string;
  refillAmount?: number;
}

type BalanceValidation = { update: IBalanceUpdate } | { error: string };

function isNonNegativeNumber(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

/** Validates a PATCH body into an `IBalanceUpdate`, or returns a human-readable error. */
function buildBalanceUpdate(body: BalancePatchBody): BalanceValidation {
  const update: IBalanceUpdate = {};

  if (body.tokenCredits !== undefined) {
    if (!isNonNegativeNumber(body.tokenCredits)) {
      return { error: 'tokenCredits must be a non-negative number' };
    }
    update.tokenCredits = Math.round(body.tokenCredits);
  }

  if (body.autoRefillEnabled !== undefined) {
    if (typeof body.autoRefillEnabled !== 'boolean') {
      return { error: 'autoRefillEnabled must be a boolean' };
    }
    update.autoRefillEnabled = body.autoRefillEnabled;
  }

  if (body.refillAmount !== undefined) {
    if (!isNonNegativeNumber(body.refillAmount)) {
      return { error: 'refillAmount must be a non-negative number' };
    }
    update.refillAmount = Math.round(body.refillAmount);
  }

  if (body.refillIntervalValue !== undefined) {
    if (!Number.isInteger(body.refillIntervalValue) || body.refillIntervalValue < 1) {
      return { error: 'refillIntervalValue must be a positive integer' };
    }
    update.refillIntervalValue = body.refillIntervalValue;
  }

  if (body.refillIntervalUnit !== undefined) {
    if (typeof body.refillIntervalUnit !== 'string' || !REFILL_UNITS.has(body.refillIntervalUnit)) {
      return { error: 'Invalid refillIntervalUnit' };
    }
    update.refillIntervalUnit = body.refillIntervalUnit as RefillIntervalUnit;
  }

  return { update };
}

export function createAdminBalanceHandlers(deps: AdminBalanceDeps) {
  const { findUser, findBalanceByUser, findBalancesByUsers, upsertBalanceFields } = deps;

  async function getUsersBalancesHandler(req: ServerRequest, res: Response) {
    try {
      const rawIds = req.query.ids;
      const idsStr = typeof rawIds === 'string' ? rawIds : '';
      const requested = idsStr
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      if (requested.length === 0) {
        return res.status(400).json({ error: 'Query parameter "ids" is required' });
      }
      if (requested.length > MAX_BULK_IDS) {
        return res.status(400).json({ error: `Too many ids (max ${MAX_BULK_IDS})` });
      }

      const validIds = requested.filter(isValidObjectIdString);
      if (validIds.length === 0) {
        return res.status(400).json({ error: 'No valid user ids provided' });
      }

      const docs = await findBalancesByUsers(validIds);
      const byUser = new Map(docs.map((d) => [d.user.toString(), d]));
      const balances = validIds.map((id) => mapBalance(id, byUser.get(id) ?? null));

      return res.status(200).json({ balances });
    } catch (error) {
      logger.error('[adminBalance] getUsersBalances error:', error);
      return res.status(500).json({ error: 'Failed to get balances' });
    }
  }

  async function getUserBalanceHandler(req: ServerRequest, res: Response) {
    try {
      const { id } = req.params as { id: string };
      if (!isValidObjectIdString(id)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }

      const user = await findUser({ _id: id }, '_id');
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const balance = await findBalanceByUser(id);
      return res.status(200).json(mapBalance(id, balance));
    } catch (error) {
      logger.error('[adminBalance] getUserBalance error:', error);
      return res.status(500).json({ error: 'Failed to get user balance' });
    }
  }

  async function setUserBalanceHandler(req: ServerRequest, res: Response) {
    try {
      const { id } = req.params as { id: string };
      if (!isValidObjectIdString(id)) {
        return res.status(400).json({ error: 'Invalid user ID format' });
      }

      const validation = buildBalanceUpdate((req.body ?? {}) as BalancePatchBody);
      if ('error' in validation) {
        return res.status(400).json({ error: validation.error });
      }
      if (Object.keys(validation.update).length === 0) {
        return res.status(400).json({ error: 'No updatable balance fields provided' });
      }

      const user = await findUser({ _id: id }, '_id');
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const updated = await upsertBalanceFields(id, validation.update);
      return res.status(200).json(mapBalance(id, updated));
    } catch (error) {
      logger.error('[adminBalance] setUserBalance error:', error);
      return res.status(500).json({ error: 'Failed to update user balance' });
    }
  }

  return {
    getUsersBalances: getUsersBalancesHandler,
    getUserBalance: getUserBalanceHandler,
    setUserBalance: setUserBalanceHandler,
  };
}
