import { useEffect } from 'react';
import type { RefObject } from 'react';
import { trimSelectionEnd } from '~/utils/selectionEnd';

/**
 * Ends a transcript selection at its last character AT THE MOMENT OF COPYING —
 * see `trimSelectionEnd` for what the browser gets wrong and why.
 *
 * The adjustment hangs on the `copy` event rather than on a mouse release, and
 * that is the whole point: it no longer matters how the selection was made or
 * what had focus while it was made. The earlier mouse-release version had to
 * guess both, and a case it guessed wrong — the composer keeps the caret after
 * a send — still copied blank lines (owner, 06.09). Measured in Chromium:
 * mouse, keyboard and a selection built with no pointer event at all now copy
 * the same clean text; a Select All, which starts outside the transcript, is
 * left to the browser as before.
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
    /* `copy` only: a cut over the transcript copies nothing (Chromium runs no
     * default action on a non-editable selection — measured), and the one
     * editable spot inside the log, a message being edited, holds a collapsed
     * range that this leaves alone anyway. */
    document.addEventListener('copy', onCopy);
    return () => document.removeEventListener('copy', onCopy);
  }, [container]);
}
