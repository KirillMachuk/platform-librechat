import React from 'react';
import { ThemeContext } from '@librechat/client';
import { RecoilRoot, useSetRecoilState } from 'recoil';
import { renderHook, act } from '@testing-library/react';
import type { TUser, TUserPreferences } from 'librechat-data-provider';
import useApplyPreferences from '../useApplyPreferences';
import useSyncPreferences from '../useSyncPreferences';
import store from '~/store';

const mockMutate = jest.fn();

jest.mock('~/data-provider', () => ({
  useUpdateUserPreferencesMutation: () => ({ mutate: mockMutate }),
}));

const themeValue = {
  theme: 'system',
  setTheme: jest.fn(),
  setThemeRGB: () => undefined,
  setThemeName: () => undefined,
  resetTheme: () => undefined,
};

const employee = (preferences: TUserPreferences = {}) =>
  ({ id: 'employee-1', preferences }) as TUser;

/**
 * The whole path a real change takes: a switch in the Settings dialog moves a store, the
 * store persists it, and the persisted write is what the account sync notices.
 */
function renderRoundTrip(user: TUser) {
  return renderHook(
    () => {
      const setUser = useSetRecoilState(store.user);
      React.useEffect(() => setUser(user), [setUser]);
      useSyncPreferences(true);
      return {
        apply: useApplyPreferences(),
        setEnterToSend: useSetRecoilState(store.enterToSend),
      };
    },
    {
      wrapper: ({ children }) => (
        <RecoilRoot>
          <ThemeContext.Provider value={themeValue}>{children}</ThemeContext.Provider>
        </RecoilRoot>
      ),
    },
  );
}

describe('preferences round trip', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockMutate.mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('carries a switch flipped in the interface up to the account', async () => {
    const { result } = renderRoundTrip(employee());
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    mockMutate.mockClear();

    act(() => {
      result.current.setEnterToSend(false);
    });
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    expect(localStorage.getItem('enterToSend')).toBe('false');
    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate.mock.calls[0][0]).toEqual({ enterToSend: 'false' });
  });

  it('does not send back what it has just taken from the account', async () => {
    const signedIn = employee({ enterToSend: 'false', autoScroll: 'true' });
    const { result } = renderRoundTrip(signedIn);

    act(() => {
      result.current.apply(signedIn);
    });
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    expect(localStorage.getItem('enterToSend')).toBe('false');
    expect(mockMutate).not.toHaveBeenCalled();
  });
});
