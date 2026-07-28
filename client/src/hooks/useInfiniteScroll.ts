import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { throttle } from 'lodash';

interface UseInfiniteScrollOptions {
  hasNextPage?: boolean;
  isLoading?: boolean;
  fetchNextPage: () => void;
  threshold?: number; // Percentage of scroll position to trigger fetch (0-1)
  throttleMs?: number; // Throttle delay in milliseconds
}

/**
 * Custom hook for implementing infinite scroll functionality
 * Detects when user scrolls near the bottom and triggers data fetching
 */
export const useInfiniteScroll = ({
  hasNextPage = false,
  isLoading = false,
  fetchNextPage,
  threshold = 0.8, // Trigger when 80% scrolled
  throttleMs = 200,
}: UseInfiniteScrollOptions) => {
  // Monitor resizing of the scroll container
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [scrollElement, setScrollElementState] = useState<HTMLElement | null>(null);

  // Handler to check if we need to fetch more data
  const handleNeedToFetch = useCallback(() => {
    if (!scrollElement) return;

    const { scrollTop, scrollHeight, clientHeight } = scrollElement;

    // Calculate scroll position as percentage
    const scrollPosition = (scrollTop + clientHeight) / scrollHeight;

    // Check if we've scrolled past the threshold and conditions are met
    const shouldFetch = scrollPosition >= threshold && hasNextPage && !isLoading;

    if (shouldFetch) {
      fetchNextPage();
    }
  }, [scrollElement, hasNextPage, isLoading, fetchNextPage, threshold]);

  /**
   * The throttle has to outlive the handler it wraps. `handleNeedToFetch` gets a
   * new identity whenever `hasNextPage` / `isLoading` / `fetchNextPage` change —
   * i.e. on every step of a page load — and throttling state lives *inside* the
   * throttled function, so re-wrapping it reset the window and let the very next
   * render fire another leading-edge call. That is what made the grid request the
   * same next page twice under a slow layout pass. Wrapping a ref instead keeps
   * one throttle for the lifetime of the hook while still running current logic.
   */
  const handlerRef = useRef(handleNeedToFetch);
  useEffect(() => {
    handlerRef.current = handleNeedToFetch;
  }, [handleNeedToFetch]);

  const throttledHandleNeedToFetch = useMemo(
    () => throttle(() => handlerRef.current(), throttleMs),
    [throttleMs],
  );

  // Clean up throttled function on unmount
  useEffect(() => {
    return () => {
      throttledHandleNeedToFetch.cancel?.();
    };
  }, [throttledHandleNeedToFetch]);

  /**
   * Re-check after a load settles, and after `hasNextPage` flips — together these
   * cover what the listener effect below used to re-check incidentally, back when
   * it re-ran on every handler identity change.
   */
  useEffect(() => {
    if (isLoading === false && scrollElement) {
      // Use requestAnimationFrame to ensure DOM is ready after loading completes
      const rafId = requestAnimationFrame(() => {
        throttledHandleNeedToFetch();
      });
      return () => cancelAnimationFrame(rafId);
    }
  }, [isLoading, hasNextPage, scrollElement, throttledHandleNeedToFetch]);

  // Set up scroll listener and ResizeObserver
  useEffect(() => {
    const element = scrollElement;
    if (!element) return;

    // Add the scroll listener
    element.addEventListener('scroll', throttledHandleNeedToFetch, { passive: true });

    // Set up ResizeObserver to detect size changes
    if (resizeObserverRef.current) {
      resizeObserverRef.current.disconnect();
    }

    resizeObserverRef.current = new ResizeObserver(() => {
      // Check if we need to fetch more data when container resizes
      throttledHandleNeedToFetch();
    });

    resizeObserverRef.current.observe(element);

    // Check immediately when element changes
    throttledHandleNeedToFetch();

    return () => {
      element.removeEventListener('scroll', throttledHandleNeedToFetch);
      // Clean up ResizeObserver
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
    };
  }, [scrollElement, throttledHandleNeedToFetch]);

  // Function to manually set the scroll container
  const setScrollElement = useCallback((element: HTMLElement | null) => {
    setScrollElementState(element);
  }, []);

  return {
    setScrollElement,
  };
};
