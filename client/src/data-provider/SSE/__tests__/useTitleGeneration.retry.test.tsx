/**
 * Retry-budget suite for `useTitleGeneration`, driven by a REAL `QueryClient`.
 *
 * The sibling suites mock `@tanstack/react-query` away, so the `retry`/`retryDelay`
 * options the hook actually passes are never executed there — `queries.test.ts`
 * asserts a hand-written copy of the predicate, which cannot fail if the real one
 * changes. This suite runs the real query machinery against a `/gen_title` endpoint
 * that answers 404 forever (what a stand with `TITLE_CONVO=false` does, and what the
 * server also returns while a title is still being generated) and pins the request
 * budget, so an unbounded poll fails the build.
 *
 * Measured on the mock e2e profile before the budget was trimmed: 8 requests over
 * ~2.6 min for a single new conversation, each held ~15.5s by the server's own wait
 * loop, with 8 matching 404s in the browser console.
 */
jest.mock('~/utils', () => ({
  isNotFoundError: jest.requireActual('~/utils/errors').isNotFoundError,
  updateConvoInAllQueries: jest.fn(),
}));

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    apiBaseUrl: () => '',
    request: { get: jest.fn() },
    dataService: { genTitle: jest.fn(), getActiveJobs: jest.fn() },
  };
});

let mockTiming: 'immediate' | 'final' = 'immediate';
jest.mock('../../Endpoints', () => ({
  useGetStartupConfig: () => ({ data: { titleGenerationTiming: mockTiming } }),
}));

import React from 'react';
import { RecoilRoot } from 'recoil';
import { renderHook, act } from '@testing-library/react';
import { QueryKeys, dataService } from 'librechat-data-provider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  genTitleQueryKey,
  useTitleGeneration,
  queueTitleGeneration,
  resetTitleGenerationState,
} from '../queries';

const genTitle = dataService.genTitle as jest.Mock;
const getActiveJobs = dataService.getActiveJobs as jest.Mock;

/** One initial attempt plus the three 404 retries the hook is allowed. */
const ATTEMPTS_PER_CYCLE = 4;

/** Simulated quiet stretch used to prove the polling really stopped. */
const IDLE_WINDOW_MS = 5 * 60_000;

/* Simulated time is advanced in one-second slices, so a case walks through
 * hundreds of React commits. Well under a second here, but the default 5s
 * budget is close enough to a loaded CI runner to be worth widening. */
jest.setTimeout(30_000);

/** Axios-shaped failure, matching what `request.get` rejects with. */
function httpError(status: number): Error {
  const err = new Error(`Request failed with status code ${status}`) as Error & {
    isAxiosError: boolean;
    response: { status: number };
  };
  err.isAxiosError = true;
  err.response = { status };
  return err;
}

let queryClient: QueryClient;

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(
    QueryClientProvider,
    { client: queryClient },
    React.createElement(RecoilRoot, null, children),
  );

/**
 * Advance simulated time in one-second slices, each in its own `act`. Timers must be
 * flushed in slices: a single long advance resolves every timer before React commits
 * the state updates their promises produced, so a refetch scheduled by one of those
 * updates lands at the very end of the window instead of inside it.
 */
async function tick(ms: number) {
  const step = 1_000;
  for (let elapsed = 0; elapsed < ms; elapsed += step) {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(Math.min(step, ms - elapsed));
    });
  }
}

async function startPolling(conversationId: string) {
  renderHook(() => useTitleGeneration(true), { wrapper });
  await act(async () => {
    queueTitleGeneration(conversationId);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockTiming = 'immediate';
  resetTitleGenerationState();
  genTitle.mockReset();
  getActiveJobs.mockReset();
  getActiveJobs.mockResolvedValue({ activeJobIds: [] });
  queryClient = new QueryClient({
    logger: { log: () => {}, warn: () => {}, error: () => {} },
    defaultOptions: { queries: { retry: false } },
  });
});

afterEach(() => {
  queryClient.clear();
  jest.useRealTimers();
});

describe('useTitleGeneration — request budget on a 404ing endpoint', () => {
  it('stops after one retry cycle when the stream is already complete', async () => {
    genTitle.mockRejectedValue(httpError(404));

    await startPolling('conv-404');
    await tick(60_000);
    const settled = genTitle.mock.calls.length;

    await tick(IDLE_WINDOW_MS);

    expect(settled).toBe(ATTEMPTS_PER_CYCLE);
    expect(genTitle).toHaveBeenCalledTimes(ATTEMPTS_PER_CYCLE);
  });

  it('leaves the conversation on its existing title and clears the queue', async () => {
    genTitle.mockRejectedValue(httpError(404));
    queryClient.setQueryData([QueryKeys.conversation, 'conv-fallback'], {
      conversationId: 'conv-fallback',
      title: 'New Chat',
    });

    await startPolling('conv-fallback');
    await tick(60_000);

    expect(queryClient.getQueryData([QueryKeys.conversation, 'conv-fallback'])).toEqual({
      conversationId: 'conv-fallback',
      title: 'New Chat',
    });
    /* The hook has to let the query go, not sit on an errored one: a conversation
     * left in the fetch set keeps an observer alive for the rest of the session. */
    const observers = queryClient
      .getQueryCache()
      .find(genTitleQueryKey('conv-fallback'))
      ?.getObserversCount();
    expect(observers ?? 0).toBe(0);
    /* Marked processed, so a later re-queue (finalHandler fires after the stream
     * handler already queued the same id) cannot restart the polling. */
    await act(async () => {
      queueTitleGeneration('conv-fallback');
    });
    await tick(60_000);
    expect(genTitle).toHaveBeenCalledTimes(ATTEMPTS_PER_CYCLE);
  });

  it('grants a second cycle only to a fetch that failed while the stream was live', async () => {
    genTitle.mockRejectedValue(httpError(404));
    getActiveJobs.mockResolvedValue({ activeJobIds: ['conv-active'] });

    await startPolling('conv-active');
    await tick(60_000);
    expect(genTitle).toHaveBeenCalledTimes(ATTEMPTS_PER_CYCLE);

    /* Stream completes: the deferred conversation gets exactly one fresh cycle. */
    getActiveJobs.mockResolvedValue({ activeJobIds: [] });
    await tick(60_000);
    expect(genTitle).toHaveBeenCalledTimes(2 * ATTEMPTS_PER_CYCLE);

    await tick(IDLE_WINDOW_MS);
    expect(genTitle).toHaveBeenCalledTimes(2 * ATTEMPTS_PER_CYCLE);
  });

  it('keeps the second cycle in final mode, where no title event can follow', async () => {
    /* `final` generates the title only after the job completes and the stream is
     * closed, so nothing can be pushed over SSE: the poll is the sole channel and
     * has to outlast a title model running to its long timeout. */
    mockTiming = 'final';
    genTitle.mockRejectedValue(httpError(404));

    await startPolling('conv-final');
    await tick(120_000);
    expect(genTitle).toHaveBeenCalledTimes(2 * ATTEMPTS_PER_CYCLE);

    await tick(5 * 60_000);
    expect(genTitle).toHaveBeenCalledTimes(2 * ATTEMPTS_PER_CYCLE);
  });

  it('does not retry a non-404 failure', async () => {
    genTitle.mockRejectedValue(httpError(500));

    await startPolling('conv-500');
    await tick(60_000);

    expect(genTitle).toHaveBeenCalledTimes(1);
  });

  it('still applies a title that only arrives after two 404s', async () => {
    genTitle
      .mockRejectedValueOnce(httpError(404))
      .mockRejectedValueOnce(httpError(404))
      .mockResolvedValue({ title: 'Quantum Chat' });
    queryClient.setQueryData([QueryKeys.conversation, 'conv-late'], {
      conversationId: 'conv-late',
      title: 'New Chat',
    });

    await startPolling('conv-late');
    await tick(60_000);

    expect(genTitle).toHaveBeenCalledTimes(3);
    expect(queryClient.getQueryData([QueryKeys.conversation, 'conv-late'])).toEqual({
      conversationId: 'conv-late',
      title: 'Quantum Chat',
    });
  });
});
