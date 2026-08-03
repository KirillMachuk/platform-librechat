import { sanitizeUserPreferences } from 'librechat-data-provider';
import type { TUserPreferences } from 'librechat-data-provider';

/**
 * Normalizes the stored shape of a user's preferences. Mongoose hands back a `Map` for a
 * hydrated document and a plain object for a lean one, and neither is what callers want.
 */
export function toPreferencesRecord(
  raw: Map<string, string> | TUserPreferences | null | undefined,
): TUserPreferences {
  if (raw instanceof Map) {
    return Object.fromEntries(raw) as TUserPreferences;
  }
  if (raw && typeof raw === 'object') {
    return raw;
  }
  return {};
}

export interface PreferencesPayloadResult {
  preferences: TUserPreferences;
  /** Keys the caller sent that this build does not accept, for the response body. */
  rejected: string[];
}

/**
 * Reduces a request body to the preferences this build accepts.
 *
 * Rejected keys are reported rather than failing the whole call: a client one deploy
 * behind should still get its known settings saved instead of losing the batch, and the
 * list gives the caller something concrete to log.
 */
export function readPreferencesPayload(body: unknown): PreferencesPayloadResult | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }

  const { preferences } = body as { preferences?: unknown };
  if (typeof preferences !== 'object' || preferences === null || Array.isArray(preferences)) {
    return null;
  }

  const sanitized = sanitizeUserPreferences(preferences);
  const accepted = new Set(Object.keys(sanitized));
  const rejected = Object.keys(preferences).filter((key) => !accepted.has(key));

  return { preferences: sanitized, rejected };
}
