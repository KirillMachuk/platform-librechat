import { useCallback, useContext, useRef } from 'react';
import { useStore } from 'jotai';
import { useRecoilCallback } from 'recoil';
import { ThemeContext } from '@librechat/client';
import type { TUser, TUserPreferences, UserPreferenceKey } from 'librechat-data-provider';
import { readStoredPreferences, resolvePreferences } from '~/utils/preferences';
import { preferenceAppliers } from './appliers';

/**
 * Puts an employee's saved settings onto this device at sign-in.
 *
 * Runs before the signed-in interface mounts, so stores hold the right values the first
 * time instead of flashing a default, and so a second employee signing in on the same
 * computer does not inherit the first one's setup. Settings the account has never seen
 * are left as they are and returned, for the first upload to carry up.
 *
 * Applied once per person per page load. The session token is refreshed periodically
 * with a fresh copy of the account, and re-applying it would undo a setting the employee
 * changed in the seconds before that copy was taken.
 */
export default function useApplyPreferences(): (user?: TUser) => TUserPreferences {
  const { setTheme } = useContext(ThemeContext);
  const jotai = useStore();
  const appliedForRef = useRef<string | undefined>(undefined);
  /** The theme context is rebuilt whenever the theme changes; holding the setter in a ref
   *  keeps this callback stable, so the debounced sign-in handler is not rebuilt with it. */
  const setThemeRef = useRef(setTheme);
  setThemeRef.current = setTheme;

  const applyResolved = useRecoilCallback(
    ({ set }) =>
      (resolved: TUserPreferences, theme: (value: string) => void) => {
        for (const key of Object.keys(resolved) as UserPreferenceKey[]) {
          const value = resolved[key];
          if (value === undefined) {
            continue;
          }
          preferenceAppliers[key](value, { setRecoil: set, jotai, setTheme: theme });
        }
      },
    [jotai],
  );

  return useCallback(
    (user?: TUser) => {
      if (user?.id == null || appliedForRef.current === user.id) {
        return {};
      }
      appliedForRef.current = user.id;
      const { resolved, pending } = resolvePreferences(user.preferences, readStoredPreferences());
      applyResolved(resolved, setThemeRef.current);
      return pending;
    },
    [applyResolved],
  );
}
