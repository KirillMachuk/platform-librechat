import { useEffect } from 'react';
import type { RefObject } from 'react';
import { trimSelectionEnd } from '~/utils/selectionEnd';

/**
 * Ends a transcript selection at its last character AT THE MOMENT OF COPYING —
 * see `trimSelectionEnd` for what the browser gets wrong and why.
 *
 * The adjustment hangs on the `copy` event rather than on a mouse release, and
 * that is the whole point: the clipboard is then correct no matter HOW the
 * selection was made — mouse, keyboard, Shift+click, a phone's selection
 * handles, Select All — in any engine, and whatever had focus while it was
 * made. The earlier mouse-release version had to guess all of that, and a case
 * it guessed wrong still copied blank lines (owner, 06.09).
 *
 * The browser serialises the selection when the default action runs, after
 * this handler returns, so adjusting it here fixes BOTH clipboard flavours —
 * text and rich — without us composing either by hand.
 *
 * A copy made while a text field holds the caret — the composer keeps focus
 * after a send — needs no special case: the field's own selection lives inside
 * the control and the document reports a collapsed range, which
 * `trimSelectionEnd` leaves alone. Asking who had focus instead is exactly the
 * defect this replaces.
 */
export default function useTrimSelectionEnd(container: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const onCopy = () => {
      const root = container.current;
      if (!root) {
        return;
      }
      const selection = document.getSelection();
      if (!selection) {
        return;
      }
      trimSelectionEnd(selection, root);
    };
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCopy);
    return () => {
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCopy);
    };
  }, [container]);
}
