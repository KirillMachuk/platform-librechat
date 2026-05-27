import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const HIGHLIGHT_MS = 1500;
const SCROLL_DELAY_MS = 80;
const HASH_PATTERN = /^#msg=([\w-]+)$/;

export default function useScrollToMessage(isReady: boolean) {
  const { hash, pathname, search } = useLocation();

  useEffect(() => {
    if (!isReady) {
      return;
    }
    const match = hash.match(HASH_PATTERN);
    if (!match) {
      return;
    }
    const messageId = match[1];
    let highlightTimer: ReturnType<typeof setTimeout> | undefined;

    const scrollTimer = setTimeout(() => {
      const el = document.getElementById(messageId);
      if (!el) {
        return;
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('search-highlight');
      highlightTimer = setTimeout(() => {
        el.classList.remove('search-highlight');
        window.history.replaceState(null, '', `${pathname}${search}`);
      }, HIGHLIGHT_MS);
    }, SCROLL_DELAY_MS);

    return () => {
      clearTimeout(scrollTimer);
      if (highlightTimer !== undefined) {
        clearTimeout(highlightTimer);
      }
    };
  }, [hash, pathname, search, isReady]);
}
