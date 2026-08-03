import {
  diffPreferences,
  storePreference,
  resolvePreferences,
  readStoredPreferences,
} from '../preferences';

describe('readStoredPreferences', () => {
  beforeEach(() => localStorage.clear());

  it('collects only the settings that belong to the account', () => {
    localStorage.setItem('autoScroll', 'true');
    localStorage.setItem('color-theme', 'dark');
    localStorage.setItem('sidebarExpanded', 'false');
    localStorage.setItem('LAST_WEB_SEARCH_TOGGLE_abc-123', 'true');

    expect(readStoredPreferences()).toEqual({ autoScroll: 'true', 'color-theme': 'dark' });
  });

  it('ignores a value this build would not accept', () => {
    localStorage.setItem('autoScroll', 'sure');
    localStorage.setItem('color-theme', 'neon');
    localStorage.setItem('enterToSend', 'false');

    expect(readStoredPreferences()).toEqual({ enterToSend: 'false' });
  });
});

describe('storePreference', () => {
  beforeEach(() => localStorage.clear());

  it('writes the value as the browser expects to read it back', () => {
    storePreference('autoScroll', 'true');
    expect(localStorage.getItem('autoScroll')).toBe('true');
  });

  it('refreshes the companion timestamp for entries the browser sweeps', () => {
    storePreference('LAST_WEB_SEARCH_TOGGLE_new', 'false');

    expect(localStorage.getItem('LAST_WEB_SEARCH_TOGGLE_new')).toBe('false');
    const timestamp = localStorage.getItem('LAST_WEB_SEARCH_TOGGLE_new_TIMESTAMP');
    expect(timestamp).not.toBeNull();
    expect(Number(timestamp)).toBeGreaterThan(0);
  });

  it('leaves a timestamp off entries that do not expire', () => {
    storePreference('autoScroll', 'true');
    expect(localStorage.getItem('autoScroll_TIMESTAMP')).toBeNull();
  });
});

describe('resolvePreferences', () => {
  it('lets the account overrule what this browser had', () => {
    const { resolved, pending } = resolvePreferences(
      { 'color-theme': 'dark' },
      { 'color-theme': 'light' },
    );

    expect(resolved['color-theme']).toBe('dark');
    expect(pending).toEqual({});
  });

  it('keeps a setting the account has never seen and marks it for upload', () => {
    const { resolved, pending } = resolvePreferences(
      { autoScroll: 'true' },
      { enterToSend: 'false' },
    );

    expect(resolved).toEqual({ autoScroll: 'true', enterToSend: 'false' });
    expect(pending).toEqual({ enterToSend: 'false' });
  });

  it('treats a first sign-in with nothing saved anywhere as nothing to do', () => {
    expect(resolvePreferences(undefined, {})).toEqual({ resolved: {}, pending: {} });
  });

  it('carries a whole browser up when the account is still empty', () => {
    const stored = { autoScroll: 'true', 'color-theme': 'dark', enterToSend: 'false' };

    const { resolved, pending } = resolvePreferences(undefined, stored);

    expect(resolved).toEqual(stored);
    expect(pending).toEqual(stored);
  });

  it('falls back to the browser when the account holds something unusable', () => {
    const { resolved, pending } = resolvePreferences(
      { 'color-theme': 'neon' },
      { 'color-theme': 'light' },
    );

    expect(resolved['color-theme']).toBe('light');
    expect(pending).toEqual({ 'color-theme': 'light' });
  });

  it('ignores an unusable account value with nothing local to fall back on', () => {
    expect(resolvePreferences({ autoScroll: 'maybe' }, {})).toEqual({ resolved: {}, pending: {} });
  });
});

describe('diffPreferences', () => {
  it('reports only what moved', () => {
    const changed = diffPreferences(
      { autoScroll: 'true', enterToSend: 'false' },
      { autoScroll: 'true', enterToSend: 'true' },
    );

    expect(changed).toEqual({ enterToSend: 'false' });
  });

  it('reports a setting the account does not have yet', () => {
    expect(diffPreferences({ autoScroll: 'true' }, {})).toEqual({ autoScroll: 'true' });
  });

  it('says nothing when the two sides agree', () => {
    expect(diffPreferences({ autoScroll: 'true' }, { autoScroll: 'true' })).toEqual({});
  });

  it('does not report a swept entry as a setting the employee cleared', () => {
    expect(diffPreferences({}, { autoScroll: 'true' })).toEqual({});
  });
});
