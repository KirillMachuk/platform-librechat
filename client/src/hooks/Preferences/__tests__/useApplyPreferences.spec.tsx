import React from 'react';
import Cookies from 'js-cookie';
import { ThemeContext } from '@librechat/client';
import { RecoilRoot, useRecoilValue } from 'recoil';
import { renderHook, act } from '@testing-library/react';
import type { TUser, TUserPreferences } from 'librechat-data-provider';
import useApplyPreferences from '../useApplyPreferences';
import store from '~/store';

const setTheme = jest.fn();

const themeValue = {
  theme: 'system',
  setTheme,
  setThemeRGB: () => undefined,
  setThemeName: () => undefined,
  resetTheme: () => undefined,
};

/** Runs the hook alongside live reads of the stores it is supposed to move. */
function renderApply() {
  return renderHook(
    () => ({
      apply: useApplyPreferences(),
      autoScroll: useRecoilValue(store.autoScroll),
      enterToSend: useRecoilValue(store.enterToSend),
      speechToText: useRecoilValue(store.speechToText),
      decibelValue: useRecoilValue(store.decibelValue),
      chatDirection: useRecoilValue(store.chatDirection),
    }),
    {
      wrapper: ({ children }) => (
        <RecoilRoot>
          <ThemeContext.Provider value={themeValue}>{children}</ThemeContext.Provider>
        </RecoilRoot>
      ),
    },
  );
}

let nextId = 0;
/** Each case is a fresh sign-in; the hook applies once per person per page load. */
const signIn = (preferences?: TUserPreferences): TUser =>
  ({ id: `employee-${(nextId += 1)}`, preferences }) as TUser;

describe('useApplyPreferences', () => {
  beforeEach(() => {
    localStorage.clear();
    Cookies.remove('lang');
    setTheme.mockReset();
  });

  it('puts the account settings onto the live interface', () => {
    const { result } = renderApply();
    expect(result.current.autoScroll).toBe(false);

    act(() => {
      result.current.apply(
        signIn({ autoScroll: 'true', decibelValue: '-30', chatDirection: '"RTL"' }),
      );
    });

    expect(result.current.autoScroll).toBe(true);
    expect(result.current.decibelValue).toBe(-30);
    expect(result.current.chatDirection).toBe('RTL');
  });

  it('overrules what the previous person left in this browser', () => {
    localStorage.setItem('speechToText', 'true');
    const { result } = renderApply();

    act(() => {
      result.current.apply(signIn({ speechToText: 'false' }));
    });

    expect(result.current.speechToText).toBe(false);
    expect(localStorage.getItem('speechToText')).toBe('false');
  });

  it('keeps a setting the account has never seen and reports it for upload', () => {
    localStorage.setItem('enterToSend', 'false');
    const { result } = renderApply();
    let pending: TUserPreferences = {};

    act(() => {
      pending = result.current.apply(signIn({ autoScroll: 'true' }));
    });

    expect(result.current.enterToSend).toBe(false);
    expect(result.current.autoScroll).toBe(true);
    expect(pending).toEqual({ enterToSend: 'false' });
  });

  it('leaves the interface at its defaults for a brand-new account', () => {
    const { result } = renderApply();
    let pending: TUserPreferences = {};

    act(() => {
      pending = result.current.apply(signIn(undefined));
    });

    expect(result.current.autoScroll).toBe(false);
    expect(result.current.enterToSend).toBe(true);
    expect(pending).toEqual({});
  });

  it('applies the theme through the theme provider, in the raw form it stores', () => {
    const { result } = renderApply();

    act(() => {
      result.current.apply(signIn({ 'color-theme': 'dark' }));
    });

    expect(setTheme).toHaveBeenCalledWith('dark');
  });

  it('restores the language into the cookie the server reads as well', () => {
    const { result } = renderApply();

    act(() => {
      result.current.apply(signIn({ lang: '"ru-RU"' }));
    });

    expect(Cookies.get('lang')).toBe('ru-RU');
  });

  it('restores a pinned tool into browser storage', () => {
    const { result } = renderApply();

    act(() => {
      result.current.apply(signIn({ LAST_WEB_SEARCH_TOGGLE_pinned: 'true' }));
    });

    expect(localStorage.getItem('LAST_WEB_SEARCH_TOGGLE_pinned')).toBe('true');
  });

  it('restores a new-chat tool default with the timestamp that keeps it alive', () => {
    const { result } = renderApply();

    act(() => {
      result.current.apply(signIn({ LAST_WEB_SEARCH_TOGGLE_new: 'false' }));
    });

    expect(localStorage.getItem('LAST_WEB_SEARCH_TOGGLE_new')).toBe('false');
    expect(localStorage.getItem('LAST_WEB_SEARCH_TOGGLE_new_TIMESTAMP')).not.toBeNull();
  });

  it('refuses a value the running build would not accept', () => {
    localStorage.setItem('autoScroll', 'true');
    const { result } = renderApply();

    act(() => {
      result.current.apply(signIn({ autoScroll: 'perhaps', 'color-theme': 'neon' }));
    });

    expect(result.current.autoScroll).toBe(true);
    expect(setTheme).not.toHaveBeenCalled();
  });

  it('does not undo a change made since sign-in when the session is refreshed', () => {
    const { result } = renderApply();
    const employee = signIn({ autoScroll: 'true' });

    act(() => {
      result.current.apply(employee);
    });
    expect(result.current.autoScroll).toBe(true);

    act(() => {
      result.current.apply(employee);
    });

    expect(result.current.autoScroll).toBe(true);
    setTheme.mockReset();
    act(() => {
      result.current.apply({ ...employee, preferences: { 'color-theme': 'dark' } } as TUser);
    });
    expect(setTheme).not.toHaveBeenCalled();
  });

  it('still applies when a different employee signs in on the same computer', () => {
    const { result } = renderApply();

    act(() => {
      result.current.apply(signIn({ speechToText: 'true' }));
    });
    expect(result.current.speechToText).toBe(true);

    act(() => {
      result.current.apply(signIn({ speechToText: 'false' }));
    });

    expect(result.current.speechToText).toBe(false);
  });

  it('does nothing for a signed-out visitor', () => {
    const { result } = renderApply();

    act(() => {
      expect(result.current.apply(undefined)).toEqual({});
    });

    expect(setTheme).not.toHaveBeenCalled();
  });
});
