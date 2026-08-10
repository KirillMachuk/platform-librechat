import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { logger, overlayOwnsFocus } from '~/utils';

export default function useFocusChatEffect(textAreaRef: React.RefObject<HTMLTextAreaElement>) {
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (textAreaRef?.current && location.state?.focusChat) {
      logger.log(
        'conversation',
        `Focusing textarea on location state change: ${location.pathname}`,
      );

      const hasCoarsePointer = window.matchMedia?.('(pointer: coarse)').matches;
      const hasHover = window.matchMedia?.('(hover: hover)').matches;

      const path = `${location.pathname}${window.location.search ?? ''}`;
      /* Early return if mobile-like: has coarse pointer OR lacks hover */
      if (hasCoarsePointer || !hasHover) {
        navigate(path, {
          replace: true,
          state: {},
        });
        return;
      }

      /* Not while a menu or dialog is open. This effect runs on arriving at a
       * new chat, which is the same moment a person may have just clicked
       * something in the sidebar — and pulling focus out of what they opened
       * closes it, so the click reads as having done nothing. The navigate
       * below still runs either way: the state has been handled, whether or
       * not the cursor moved. */
      if (!overlayOwnsFocus()) {
        textAreaRef.current?.focus();
      }

      navigate(path, {
        replace: true,
        state: {},
      });
    }
  }, [navigate, textAreaRef, location.pathname, location.state?.focusChat]);
}
