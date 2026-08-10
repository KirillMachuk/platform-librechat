import { mainTextareaId } from '~/common';

/**
 * How long to wait before putting the cursor in the composer. The textarea is
 * still being rendered when a conversation is set up, so the focus has to come
 * after it.
 */
const COMPOSER_FOCUS_DELAY_MS = 150;

/** Overlays that own the keyboard while they are open. */
const OVERLAY_SELECTOR = '[role="menu"],[role="dialog"],[role="listbox"]';

/**
 * Whether an open overlay currently owns the keyboard.
 *
 * Taking focus away from one closes it, and the person reads that as their
 * click doing nothing. Measured on a fresh chat: clicking the account avatar
 * while the app was still settling left `document.activeElement` on
 * `div[role=menu]`, something pulled focus to the composer, and the menu shut
 * itself — 5 runs in 40, every failure with that same signature.
 *
 * Focus sitting on an ordinary control is NOT a reason to skip: arriving at a
 * new chat by clicking "New chat" leaves focus on that button, and putting the
 * cursor in the composer is exactly what should happen then. Only an overlay
 * owns the keyboard.
 */
export function overlayOwnsFocus(): boolean {
  return Boolean(document.activeElement?.closest?.(OVERLAY_SELECTOR));
}

/**
 * Puts the cursor in the composer once a conversation is set up, unless an
 * overlay is open by the time it fires. Returns a canceller.
 *
 * The delay is not decorative — the textarea is still being rendered when the
 * conversation is created — but it is also a window the person can act in,
 * which is what makes the guard necessary here.
 */
export function focusComposerUnlessBusy(): () => void {
  const timeout = setTimeout(() => {
    if (overlayOwnsFocus()) {
      return;
    }
    document.getElementById(mainTextareaId)?.focus();
  }, COMPOSER_FOCUS_DELAY_MS);

  return () => clearTimeout(timeout);
}
