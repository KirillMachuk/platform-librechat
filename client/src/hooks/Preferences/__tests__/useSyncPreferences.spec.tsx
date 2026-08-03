import React from 'react';
import { RecoilRoot, useSetRecoilState } from 'recoil';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { TUser, TUserPreferences } from 'librechat-data-provider';
import useSyncPreferences from '../useSyncPreferences';
import store from '~/store';

const mockMutate = jest.fn();

jest.mock('~/data-provider', () => ({
  useUpdateUserPreferencesMutation: () => ({ mutate: mockMutate }),
}));

const employee = (preferences?: TUserPreferences): TUser =>
  ({
    id: 'employee-1',
    email: 'employee@example.com',
    name: 'Employee',
    username: 'employee',
    avatar: '',
    role: 'USER',
    provider: 'local',
    createdAt: '',
    updatedAt: '',
    preferences,
  }) as TUser;

/** Seeds the signed-in user, then runs the hook the way Root does. */
function renderSync(user: TUser | undefined) {
  const Seed = ({ children }: { children: React.ReactNode }) => {
    const setUser = useSetRecoilState(store.user);
    const [seeded, setSeeded] = React.useState(false);
    React.useEffect(() => {
      setUser(user);
      setSeeded(true);
    }, [setUser]);
    return seeded ? <>{children}</> : null;
  };

  return renderHook(() => useSyncPreferences(user != null), {
    wrapper: ({ children }) => (
      <RecoilRoot>
        <Seed>{children}</Seed>
      </RecoilRoot>
    ),
  });
}

const raiseStorageEvent = (key: string) => {
  window.dispatchEvent(new StorageEvent('storage', { key }));
};

describe('useSyncPreferences', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockMutate.mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('sends nothing when the browser already matches the account', async () => {
    localStorage.setItem('autoScroll', 'true');
    renderSync(employee({ autoScroll: 'true' }));

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('carries settings the account has never seen up on sign-in', async () => {
    localStorage.setItem('enterToSend', 'false');
    localStorage.setItem('color-theme', 'dark');
    renderSync(employee({ autoScroll: 'true' }));

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate.mock.calls[0][0]).toEqual({ enterToSend: 'false', 'color-theme': 'dark' });
  });

  it('sends a changed setting, and only that setting', async () => {
    localStorage.setItem('autoScroll', 'true');
    renderSync(employee({ autoScroll: 'true' }));
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(mockMutate).not.toHaveBeenCalled();

    localStorage.setItem('autoScroll', 'false');
    act(() => raiseStorageEvent('autoScroll'));
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate.mock.calls[0][0]).toEqual({ autoScroll: 'false' });
  });

  it('collects a burst of changes into one upload', async () => {
    renderSync(employee({}));
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    mockMutate.mockClear();

    localStorage.setItem('autoScroll', 'false');
    act(() => raiseStorageEvent('autoScroll'));
    localStorage.setItem('enterToSend', 'false');
    act(() => raiseStorageEvent('enterToSend'));

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate.mock.calls[0][0]).toEqual({ autoScroll: 'false', enterToSend: 'false' });
  });

  it('never lets browser storage that is none of its business reach the account', async () => {
    renderSync(employee({}));
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    mockMutate.mockClear();

    localStorage.setItem('sidebarExpanded', 'false');
    act(() => raiseStorageEvent('sidebarExpanded'));
    localStorage.setItem('LAST_WEB_SEARCH_TOGGLE_abc-123', 'true');
    act(() => raiseStorageEvent('LAST_WEB_SEARCH_TOGGLE_abc-123'));
    localStorage.setItem('autoScroll', 'false');
    act(() => raiseStorageEvent('autoScroll'));
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate.mock.calls[0][0]).toEqual({ autoScroll: 'false' });
  });

  it('leaves an unrelated storage write alone entirely', async () => {
    renderSync(employee({}));
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    mockMutate.mockClear();

    localStorage.setItem('sidebarExpanded', 'false');
    act(() => raiseStorageEvent('sidebarExpanded'));
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('flushes what is pending when the tab is being left', async () => {
    renderSync(employee({}));
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    mockMutate.mockClear();

    localStorage.setItem('autoScroll', 'false');
    act(() => raiseStorageEvent('autoScroll'));
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate.mock.calls[0][0]).toEqual({ autoScroll: 'false' });
  });

  it('retries the same change after a failed upload instead of dropping it', async () => {
    mockMutate.mockImplementation((_payload, options) => options?.onSettled?.());
    localStorage.setItem('autoScroll', 'false');
    renderSync(employee({}));

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(mockMutate).toHaveBeenCalledTimes(1);

    act(() => raiseStorageEvent('autoScroll'));
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    expect(mockMutate).toHaveBeenCalledTimes(2);
    expect(mockMutate.mock.calls[1][0]).toEqual({ autoScroll: 'false' });
  });

  it('keeps saving after an upload that never comes back', async () => {
    mockMutate.mockImplementation(() => undefined);
    localStorage.setItem('autoScroll', 'false');
    renderSync(employee({}));

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(mockMutate).toHaveBeenCalledTimes(1);

    localStorage.setItem('enterToSend', 'false');
    act(() => raiseStorageEvent('enterToSend'));
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    expect(mockMutate).toHaveBeenCalledTimes(2);
    expect(mockMutate.mock.calls[1][0]).toEqual({ autoScroll: 'false', enterToSend: 'false' });
  });

  it('ignores a late reply from a request a newer one has already replaced', async () => {
    const replies: Array<(data: { preferences: TUserPreferences }) => void> = [];
    mockMutate.mockImplementation((_payload, options) => {
      replies.push(options.onSuccess);
    });
    localStorage.setItem('autoScroll', 'false');
    renderSync(employee({}));
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    localStorage.setItem('enterToSend', 'false');
    act(() => raiseStorageEvent('enterToSend'));
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(replies).toHaveLength(2);

    act(() => {
      replies[1]({ preferences: { autoScroll: 'false', enterToSend: 'false' } });
      replies[0]({ preferences: { autoScroll: 'false' } });
    });
    act(() => raiseStorageEvent('autoScroll'));
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    expect(mockMutate).toHaveBeenCalledTimes(2);
  });

  it('stops sending a change once the account has confirmed it', async () => {
    mockMutate.mockImplementation((payload, options) => {
      options?.onSuccess?.({ preferences: payload });
      options?.onSettled?.();
    });
    localStorage.setItem('autoScroll', 'false');
    renderSync(employee({}));

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(mockMutate).toHaveBeenCalledTimes(1);

    act(() => raiseStorageEvent('autoScroll'));
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    expect(mockMutate).toHaveBeenCalledTimes(1);
  });

  it('does nothing at all for a visitor who is not signed in', async () => {
    localStorage.setItem('autoScroll', 'false');
    renderSync(undefined);

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    act(() => raiseStorageEvent('autoScroll'));
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('stops listening once the signed-in interface goes away', async () => {
    localStorage.setItem('autoScroll', 'true');
    const { unmount } = renderSync(employee({ autoScroll: 'true' }));
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    unmount();
    localStorage.setItem('autoScroll', 'false');
    act(() => raiseStorageEvent('autoScroll'));
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    await waitFor(() => expect(mockMutate).not.toHaveBeenCalled());
  });
});
