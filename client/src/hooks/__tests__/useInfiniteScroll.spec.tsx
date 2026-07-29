import { act, renderHook } from '@testing-library/react';
import { useInfiniteScroll } from '../useInfiniteScroll';

/**
 * The hook throttles its "do we need another page?" check. The throttle window
 * has to survive the state changes that a page load itself produces — otherwise
 * every re-render restarts it and the leading edge fires again, requesting the
 * same page twice. That double-fetch was intermittent in the wild (it needs a
 * layout pass slow enough that `scrollHeight` is still stale) and showed up as a
 * flaky AgentGrid test under load.
 */

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const makeScrollElement = ({ scrollHeight = 2000, clientHeight = 1000, scrollTop = 900 } = {}) => {
  const element = document.createElement('div');
  for (const [prop, value] of Object.entries({ scrollHeight, clientHeight, scrollTop })) {
    Object.defineProperty(element, prop, { value, writable: true, configurable: true });
  }
  return element;
};

describe('useInfiniteScroll', () => {
  let rafCallbacks: FrameRequestCallback[] = [];

  beforeEach(() => {
    jest.useFakeTimers();
    rafCallbacks = [];
    (global as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const flushRaf = () => {
    const pending = rafCallbacks;
    rafCallbacks = [];
    pending.forEach((cb) => cb(0));
  };

  it('fetches once per throttle window even when the handler identity keeps changing', () => {
    const scrollElement = makeScrollElement();
    /** A fresh function each render, mirroring how the query layer hands one down. */
    const fetchSpy = jest.fn();

    const { result, rerender } = renderHook(
      ({ hasNextPage }: { hasNextPage: boolean }) =>
        useInfiniteScroll({
          hasNextPage,
          isLoading: false,
          fetchNextPage: () => fetchSpy(),
          throttleMs: 200,
        }),
      { initialProps: { hasNextPage: true } },
    );

    act(() => {
      result.current.setScrollElement(scrollElement);
    });
    act(() => {
      flushRaf();
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Re-renders inside the window must not open a second leading edge.
    for (let i = 0; i < 5; i++) {
      rerender({ hasNextPage: true });
      act(() => {
        flushRaf();
      });
    }
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('does not fetch on the trailing edge once the last page has arrived', () => {
    const scrollElement = makeScrollElement();
    const fetchSpy = jest.fn();

    const { result, rerender } = renderHook(
      ({ hasNextPage }: { hasNextPage: boolean }) =>
        useInfiniteScroll({
          hasNextPage,
          isLoading: false,
          fetchNextPage: () => fetchSpy(),
          throttleMs: 200,
        }),
      { initialProps: { hasNextPage: true } },
    );

    act(() => {
      result.current.setScrollElement(scrollElement);
    });
    act(() => {
      flushRaf();
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // The page landed and there is nothing left to load; a queued trailing call
    // must read the current state, not the state captured at schedule time.
    rerender({ hasNextPage: false });
    act(() => {
      flushRaf();
      jest.advanceTimersByTime(500);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('holds off while a page is already in flight, then resumes when it lands', () => {
    const scrollElement = makeScrollElement();
    const fetchSpy = jest.fn();

    const { result, rerender } = renderHook(
      ({ isLoading }: { isLoading: boolean }) =>
        useInfiniteScroll({
          hasNextPage: true,
          isLoading,
          fetchNextPage: () => fetchSpy(),
          throttleMs: 200,
        }),
      { initialProps: { isLoading: false } },
    );

    act(() => {
      result.current.setScrollElement(scrollElement);
    });
    act(() => {
      flushRaf();
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // The request is in flight: a trailing call must read the *current* loading
    // state, not the one captured when it was scheduled.
    rerender({ isLoading: true });
    act(() => {
      flushRaf();
      jest.advanceTimersByTime(300);
      scrollElement.dispatchEvent(new Event('scroll'));
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // It landed and there is still room — the next check may fetch again.
    rerender({ isLoading: false });
    act(() => {
      flushRaf();
      jest.advanceTimersByTime(300);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('stays put when the viewport is already filled', () => {
    const scrollElement = makeScrollElement({
      scrollHeight: 5000,
      clientHeight: 500,
      scrollTop: 0,
    });
    const fetchSpy = jest.fn();

    const { result } = renderHook(() =>
      useInfiniteScroll({
        hasNextPage: true,
        isLoading: false,
        fetchNextPage: () => fetchSpy(),
        throttleMs: 200,
      }),
    );

    act(() => {
      result.current.setScrollElement(scrollElement);
    });
    act(() => {
      flushRaf();
      jest.advanceTimersByTime(500);
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
