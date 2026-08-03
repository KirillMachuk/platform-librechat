import { useEffect, useRef } from 'react';
import debounce from 'lodash/debounce';
import { useRecoilValue } from 'recoil';
import { sanitizeUserPreferences, isUserPreferenceKey } from 'librechat-data-provider';
import type { TUserPreferences } from 'librechat-data-provider';
import { diffPreferences, readStoredPreferences } from '~/utils/preferences';
import { useUpdateUserPreferencesMutation } from '~/data-provider';
import store from '~/store';

/** Long enough to collect a burst of toggles, short enough to survive a quick tab close. */
const UPLOAD_DELAY_MS = 500;

/**
 * Keeps the account's copy of the personal settings up to date with this device.
 *
 * Every change is compared against what the account is believed to hold, so an upload
 * carries only what actually moved, a failed upload is retried by the next change, and
 * a settings write echoed back by another tab does not bounce around between them.
 */
export default function useSyncPreferences(isAuthenticated: boolean): void {
  const user = useRecoilValue(store.user);
  const userId = user?.id;
  const accountPreferences = user?.preferences;

  const syncedRef = useRef<TUserPreferences>({});
  const baselineUserRef = useRef<string | undefined>(undefined);
  /**
   * Only the newest request may move the baseline. An in-flight flag would have been
   * simpler, but a request that never settles would leave it stuck and quietly stop
   * saving this employee's settings for the rest of the session.
   */
  const requestIdRef = useRef(0);
  const mutation = useUpdateUserPreferencesMutation();
  const mutateRef = useRef(mutation.mutate);
  mutateRef.current = mutation.mutate;
  /** Read when the person changes, not depended on: the user record is replaced on every
   *  session refresh, and rebuilding the listeners each time would cancel a pending
   *  upload for no reason. */
  const accountRef = useRef(accountPreferences);
  accountRef.current = accountPreferences;

  useEffect(() => {
    if (!isAuthenticated || userId == null) {
      baselineUserRef.current = undefined;
      return;
    }

    if (baselineUserRef.current !== userId) {
      baselineUserRef.current = userId;
      syncedRef.current = sanitizeUserPreferences(accountRef.current ?? {});
    }

    const upload = () => {
      const changed = diffPreferences(readStoredPreferences(), syncedRef.current);
      if (Object.keys(changed).length === 0) {
        return;
      }
      const requestId = (requestIdRef.current += 1);
      mutateRef.current(changed, {
        onSuccess: (data) => {
          if (requestId !== requestIdRef.current) {
            return;
          }
          syncedRef.current = sanitizeUserPreferences(data.preferences ?? {});
        },
      });
    };

    const scheduleUpload = debounce(upload, UPLOAD_DELAY_MS);

    /**
     * Only writes made in this tab. The browser marks a genuine cross-tab event with the
     * storage area it came from; those are another tab's changes, and that tab is already
     * saving them. Acting on them too would send the same change once per open tab.
     */
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea != null) {
        return;
      }
      if (event.key != null && !isUserPreferenceKey(event.key)) {
        return;
      }
      scheduleUpload();
    };

    /** Closing a tab reaches `hidden` first, so a change made a moment ago still lands. */
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        scheduleUpload.cancel();
        upload();
      }
    };

    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisibilityChange);
    /** Carries up whatever this browser had before the account started keeping it. */
    scheduleUpload();

    return () => {
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      scheduleUpload.cancel();
    };
  }, [isAuthenticated, userId]);
}
