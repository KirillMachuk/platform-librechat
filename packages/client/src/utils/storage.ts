/**
 * Writes a value to browser storage and tells this tab about it.
 *
 * The browser only raises `storage` events in *other* tabs, so anything watching the
 * write — the account-settings sync, hooks that mirror a key — would miss a change made
 * right here. Re-raising it locally gives every write one observable path regardless of
 * which store helper performed it.
 */
export function writeStoredValue(key: string, value: string): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return;
  }
  try {
    localStorage.setItem(key, value);
  } catch {
    return;
  }
  try {
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: value }));
  } catch {
    /** A browser without the StorageEvent constructor still got the write. */
  }
}
