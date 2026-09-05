import { useEffect } from 'react';
import type { RefObject } from 'react';
import { trimSelectionEnd } from '~/utils/selectionEnd';

/**
 * After a mouse release, ends a selection made inside the transcript at the
 * last character it covers — see `trimSelectionEnd` for what and why.
 *
 * The listener sits on the document, not on the container: a drag that is
 * released over the header, the composer or outside the window never
 * bubbles a mouseup through the container, and that is exactly the sloppy
 * drag this exists for — a drag from the last message is released over the
 * composer more often than not. The container only bounds which selections
 * count; an edit in progress is recognised by the focused field, not by
 * where the mouse went up. Mouse only: touch selection is made with the
 * browser's own handles, which dispatch no release event to the page, and a
 * trim on every selection change would snap the handles back.
 */
export default function useTrimSelectionEnd(container: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || event.button !== 0) {
        return;
      }
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
    document.addEventListener('pointerup', onPointerUp);
    return () => document.removeEventListener('pointerup', onPointerUp);
  }, [container]);
}
