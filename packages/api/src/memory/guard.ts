import axios from 'axios';
import {
  MEMORY_GUARD_TOKEN_ENV,
  MEMORY_GUARD_URL_ENV,
  isMemoryGuardConfigured,
  logger,
} from '@librechat/data-schemas';

/**
 * Screens a candidate memory for personal data before it is stored.
 *
 * A chat message carries personal data once: it is masked on the way out and its
 * retention sweep eventually removes it. A memory is different — it is replayed into
 * every later conversation and outlives the chat it came from, so one slip parks
 * someone's name, phone or contract number in permanent storage and repeats it
 * indefinitely. Screening at the moment of writing is far cheaper than guaranteeing
 * the masking layer is perfect forever.
 *
 * The screening service returns entity *types* only: a rejection reason must be safe
 * to log and safe to show, and values never need to leave it.
 */

/** What the guard decided about one candidate value. */
export type MemoryGuardOutcome = 'allowed' | 'rejected' | 'unavailable';

export interface MemoryGuardVerdict {
  outcome: MemoryGuardOutcome;
  /** Entity types that caused a rejection, e.g. `['PERSON', 'PHONE']`. Never values. */
  types?: string[];
}

/**
 * Short on purpose: the guard sits on the write path of a background extraction that
 * races the assistant's own answer, and a stalled screening service must fail fast
 * rather than hold the write open.
 */
const GUARD_TIMEOUT_MS = 5_000;

const ALLOWED: MemoryGuardVerdict = { outcome: 'allowed' };
const UNAVAILABLE: MemoryGuardVerdict = { outcome: 'unavailable' };

interface ClassifyResponse {
  count?: number;
  types?: string[];
}

/**
 * Fails closed on every uncertainty — unconfigured, unreachable, slow, or an
 * unexpected response shape all mean "do not store". A guard that lets writes
 * through whenever it is having a bad day is not a guard.
 */
export async function checkMemoryValue(value: string): Promise<MemoryGuardVerdict> {
  const url = process.env[MEMORY_GUARD_URL_ENV];
  if (!isMemoryGuardConfigured() || !url) {
    logger.error(`[memory] ${MEMORY_GUARD_URL_ENV} is not set; refusing to store memory`);
    return UNAVAILABLE;
  }

  const token = process.env[MEMORY_GUARD_TOKEN_ENV];
  try {
    const { data } = await axios.post<ClassifyResponse>(
      url,
      { text: value },
      {
        timeout: GUARD_TIMEOUT_MS,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      },
    );

    if (typeof data?.count !== 'number') {
      logger.error('[memory] Guard returned an unexpected response; refusing to store memory');
      return UNAVAILABLE;
    }

    if (data.count > 0) {
      return { outcome: 'rejected', types: data.types ?? [] };
    }

    return ALLOWED;
  } catch (error) {
    logger.error('[memory] Guard call failed; refusing to store memory', error);
    return UNAVAILABLE;
  }
}
