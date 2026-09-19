import { act, renderHook } from '@testing-library/react';
import { EModelEndpoint } from 'librechat-data-provider';
import type { TConversation } from 'librechat-data-provider';
import useNavigateToConvo from '../useNavigateToConvo';

const mockFetchQuery = jest.fn();
const mockSetConversation = jest.fn();
const mockSetSubmission = jest.fn();
const mockClearConversations = jest.fn();
const mockHasSetConversation = { current: false };
const mockNavigate = jest.fn((path: string) => window.history.replaceState({}, '', path));

jest.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));
jest.mock('recoil', () => ({ useSetRecoilState: () => mockSetSubmission }));
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    getQueryData: () => ({ openAI: {} }),
    removeQueries: jest.fn(),
    invalidateQueries: jest.fn(),
    fetchQuery: mockFetchQuery,
  }),
}));
jest.mock('librechat-data-provider', () => ({
  QueryKeys: { endpoints: 'endpoints', messages: 'messages', conversation: 'conversation' },
  Constants: { NEW_CONVO: 'new' },
  EModelEndpoint: { openAI: 'openAI' },
  dataService: { getConversationById: jest.fn() },
  getEndpointField: jest.fn(),
  getDefaultParamsEndpoint: jest.fn(),
}));
jest.mock('~/utils', () => ({
  clearModelForNonEphemeralAgent: jest.fn(),
  getDefaultEndpoint: jest.fn(),
  clearMessagesCache: jest.fn(),
  buildDefaultConvo: jest.fn(),
  buildConvoPath: ({
    conversationId,
    projectId,
  }: {
    conversationId: string;
    projectId?: string;
  }) => (projectId ? `/projects/${projectId}/c/${conversationId}` : `/c/${conversationId}`),
  logger: { log: jest.fn(), warn: jest.fn() },
}));
jest.mock('~/hooks/Agents', () => ({ useApplyModelSpecEffects: () => jest.fn() }));
jest.mock('~/data-provider', () => ({ startupConfigKey: () => ['startupConfig'] }));
jest.mock('~/store', () => ({
  __esModule: true,
  default: {
    submissionByIndex: () => ({}),
    useClearConvoState: () => mockClearConversations,
    useCreateConversationAtom: () => ({
      hasSetConversation: mockHasSetConversation,
      setConversation: mockSetConversation,
    }),
  },
}));

const conversation = (conversationId: string): TConversation => ({
  conversationId,
  endpoint: EModelEndpoint.openAI,
  title: conversationId,
  createdAt: '2026-09-19T00:00:00.000Z',
  updatedAt: '2026-09-19T00:00:00.000Z',
});

function deferredConversation() {
  let resolve!: (value: TConversation) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<TConversation>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockHasSetConversation.current = false;
  window.history.replaceState({}, '', '/c/new');
});

describe('useNavigateToConvo', () => {
  it('navigates on the first click while the conversation request is still pending', async () => {
    const pending = deferredConversation();
    mockFetchQuery.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useNavigateToConvo());

    act(() => result.current.navigateToConvo(conversation('first')));

    expect(window.location.pathname).toBe('/c/first');
    expect(mockSetConversation).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'first' }),
    );
    expect(mockFetchQuery).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve(conversation('first'));
      await pending.promise;
    });
  });

  it('does not restore an older chat when its delayed response arrives after another click', async () => {
    const first = deferredConversation();
    const second = deferredConversation();
    mockFetchQuery.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useNavigateToConvo());

    act(() => {
      result.current.navigateToConvo(conversation('first'));
      result.current.navigateToConvo(conversation('second'));
    });
    expect(window.location.pathname).toBe('/c/second');
    const callsBeforeOldResponse = mockSetConversation.mock.calls.length;

    await act(async () => {
      first.resolve(conversation('first'));
      await first.promise;
    });
    expect(window.location.pathname).toBe('/c/second');
    expect(mockSetConversation).toHaveBeenCalledTimes(callsBeforeOldResponse);

    await act(async () => {
      second.resolve(conversation('second'));
      await second.promise;
    });
    expect(mockSetConversation).toHaveBeenLastCalledWith(
      expect.objectContaining({ conversationId: 'second' }),
    );
  });

  it('corrects the path when fresh details place the chat in a project', async () => {
    const pending = deferredConversation();
    mockFetchQuery.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useNavigateToConvo());

    act(() => result.current.navigateToConvo(conversation('first')));
    expect(window.location.pathname).toBe('/c/first');

    await act(async () => {
      pending.resolve({ ...conversation('first'), project_id: 'project-a' });
      await pending.promise;
    });

    expect(window.location.pathname).toBe('/projects/project-a/c/first');
    expect(mockNavigate).toHaveBeenLastCalledWith('/projects/project-a/c/first', {
      replace: true,
      state: { focusChat: true },
    });
  });

  it('keeps the clicked chat open when refreshing its details fails', async () => {
    const pending = deferredConversation();
    mockFetchQuery.mockReturnValue(pending.promise);
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useNavigateToConvo());

    act(() => result.current.navigateToConvo(conversation('first')));
    await act(async () => {
      pending.reject(new Error('offline'));
      await pending.promise.catch(() => {});
    });

    expect(window.location.pathname).toBe('/c/first');
    expect(mockSetConversation).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });
});
