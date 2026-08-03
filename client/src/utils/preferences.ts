import { writeStoredValue } from '@librechat/client';
import {
  userPreferenceKeys,
  isValidPreferenceValue,
  getPreferenceDefinition,
} from 'librechat-data-provider';
import type { TUserPreferences, UserPreferenceKey } from 'librechat-data-provider';
import { setTimestamp } from './timestamps';

/**
 * The personal settings this browser currently holds, limited to values the running
 * build still accepts. An entry left by an older build is treated as absent rather than
 * handed on, so it can neither reach the account nor be applied to the interface.
 */
export function readStoredPreferences(): TUserPreferences {
  const stored: TUserPreferences = {};
  for (const key of userPreferenceKeys) {
    /** A browser that refuses storage must cost the employee their settings, not their
     *  sign-in: this runs on the way in. */
    let value: string | null = null;
    try {
      value = localStorage.getItem(key);
    } catch {
      return stored;
    }
    if (value !== null && isValidPreferenceValue(key, value)) {
      stored[key] = value;
    }
  }
  return stored;
}

/**
 * Persists one preference the way the browser expects to find it later, including the
 * companion timestamp that keeps short-lived entries from being swept on next startup.
 */
export function storePreference(key: UserPreferenceKey, value: string): void {
  writeStoredValue(key, value);
  if (getPreferenceDefinition(key).timestamped === true) {
    setTimestamp(key);
  }
}

export interface ResolvedPreferences {
  /** What both sides should agree on once the pending upload lands. */
  resolved: TUserPreferences;
  /** Settings this browser has and the account does not — the migration payload. */
  pending: TUserPreferences;
}

/**
 * Decides what an employee's settings should be on this device at sign-in.
 *
 * The account wins wherever it has an opinion — that is what "my settings follow me"
 * means, and it is what makes a shared workstation stop leaking one person's setup into
 * the next person's session. Where the account is silent, whatever this browser already
 * had is kept and sent up, so nobody has to re-tick the boxes they ticked before this
 * feature existed.
 */
export function resolvePreferences(
  account: TUserPreferences | undefined,
  stored: TUserPreferences,
): ResolvedPreferences {
  const resolved: TUserPreferences = {};
  const pending: TUserPreferences = {};

  for (const key of userPreferenceKeys) {
    const accountValue = account?.[key];
    if (typeof accountValue === 'string' && isValidPreferenceValue(key, accountValue)) {
      resolved[key] = accountValue;
      continue;
    }
    const storedValue = stored[key];
    if (storedValue !== undefined) {
      resolved[key] = storedValue;
      pending[key] = storedValue;
    }
  }

  return { resolved, pending };
}

/**
 * Settings whose current value differs from what the account is believed to hold.
 * Missing keys are never reported: browser storage is swept on a schedule, and a swept
 * entry means "no longer cached here", not "the employee cleared this setting".
 */
export function diffPreferences(
  current: TUserPreferences,
  synced: TUserPreferences,
): TUserPreferences {
  const changed: TUserPreferences = {};
  for (const key of Object.keys(current) as UserPreferenceKey[]) {
    const value = current[key];
    if (value !== undefined && value !== synced[key]) {
      changed[key] = value;
    }
  }
  return changed;
}
