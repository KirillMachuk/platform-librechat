import {
  userPreferenceKeys,
  isUserPreferenceKey,
  isValidPreferenceValue,
  getPreferenceDefinition,
  sanitizeUserPreferences,
  MAX_PREFERENCE_VALUE_LENGTH,
} from './preferences';
import { Constants, LocalStorageKeys } from './config';

describe('user preference registry', () => {
  it('lists every key exactly once', () => {
    expect(new Set(userPreferenceKeys).size).toBe(userPreferenceKeys.length);
  });

  it('keeps keys usable as MongoDB map paths', () => {
    for (const key of userPreferenceKeys) {
      expect(key).not.toMatch(/[.$]/);
      expect(key.length).toBeGreaterThan(0);
    }
  });

  it('stays anchored to the storage keys the interface actually writes', () => {
    expect(isUserPreferenceKey(LocalStorageKeys.AUTO_EXPAND_TOOLS)).toBe(true);
    expect(isUserPreferenceKey(LocalStorageKeys.ENABLE_USER_MSG_MARKDOWN)).toBe(true);
    expect(isUserPreferenceKey(LocalStorageKeys.PIN_MCP_)).toBe(true);
    expect(isUserPreferenceKey(`${LocalStorageKeys.LAST_WEB_SEARCH_TOGGLE_}pinned`)).toBe(true);
    expect(
      isUserPreferenceKey(`${LocalStorageKeys.LAST_WEB_SEARCH_TOGGLE_}${Constants.NEW_CONVO}`),
    ).toBe(true);
  });

  it('leaves per-conversation and per-device state out', () => {
    expect(isUserPreferenceKey('sidebarExpanded')).toBe(false);
    expect(isUserPreferenceKey('isTemporary')).toBe(false);
    expect(isUserPreferenceKey('hideBannerHint')).toBe(false);
    expect(isUserPreferenceKey(`${LocalStorageKeys.LAST_MCP_}${Constants.NEW_CONVO}`)).toBe(false);
    expect(isUserPreferenceKey('LAST_WEB_SEARCH_TOGGLE_abc-123')).toBe(false);
  });

  it('marks the short-lived entries so restoring them also refreshes their timestamp', () => {
    const toggleKey = `${LocalStorageKeys.LAST_WEB_SEARCH_TOGGLE_}${Constants.NEW_CONVO}`;
    expect(getPreferenceDefinition(toggleKey).timestamped).toBe(true);
    expect(getPreferenceDefinition('autoScroll').timestamped).toBeUndefined();
  });
});

describe('isValidPreferenceValue', () => {
  it('accepts a JSON boolean and rejects its unquoted or mistyped forms', () => {
    expect(isValidPreferenceValue('autoScroll', 'true')).toBe(true);
    expect(isValidPreferenceValue('autoScroll', 'false')).toBe(true);
    expect(isValidPreferenceValue('autoScroll', '"true"')).toBe(false);
    expect(isValidPreferenceValue('autoScroll', 'yes')).toBe(false);
    expect(isValidPreferenceValue('autoScroll', '1')).toBe(false);
    expect(isValidPreferenceValue('autoScroll', '')).toBe(false);
  });

  it('accepts finite numbers only', () => {
    expect(isValidPreferenceValue('decibelValue', '-45')).toBe(true);
    expect(isValidPreferenceValue('playbackRate', '1.5')).toBe(true);
    expect(isValidPreferenceValue('decibelValue', 'null')).toBe(false);
    expect(isValidPreferenceValue('decibelValue', '"-45"')).toBe(false);
  });

  it('holds a closed set of values to what the interface offers', () => {
    expect(isValidPreferenceValue('color-theme', 'dark')).toBe(true);
    expect(isValidPreferenceValue('color-theme', 'system')).toBe(true);
    expect(isValidPreferenceValue('color-theme', 'neon')).toBe(false);
    expect(isValidPreferenceValue('fontSize', '"text-lg"')).toBe(true);
    expect(isValidPreferenceValue('fontSize', '"text-9xl"')).toBe(false);
    expect(isValidPreferenceValue('chatDirection', '"RTL"')).toBe(true);
    expect(isValidPreferenceValue('chatDirection', '"sideways"')).toBe(false);
  });

  it('reads the theme raw, because that is how the browser stores it', () => {
    expect(isValidPreferenceValue('color-theme', '"dark"')).toBe(false);
  });

  it('caps free-form strings', () => {
    const long = JSON.stringify('x'.repeat(MAX_PREFERENCE_VALUE_LENGTH));
    expect(isValidPreferenceValue('voice', '"Alloy"')).toBe(true);
    expect(isValidPreferenceValue('voice', long)).toBe(false);
    expect(isValidPreferenceValue('lang', JSON.stringify('y'.repeat(64)))).toBe(false);
  });

  it('rejects values that are not scalars', () => {
    expect(isValidPreferenceValue('autoScroll', '{"a":1}')).toBe(false);
    expect(isValidPreferenceValue('autoScroll', '[true]')).toBe(false);
    expect(isValidPreferenceValue('autoScroll', 'not json at all')).toBe(false);
  });
});

describe('sanitizeUserPreferences', () => {
  it('keeps the recognised settings and drops the rest', () => {
    const result = sanitizeUserPreferences({
      autoScroll: 'true',
      'color-theme': 'dark',
      __proto__polluted: 'true',
      unknownSetting: 'true',
      enterToSend: 'definitely',
    });

    expect(result).toEqual({ autoScroll: 'true', 'color-theme': 'dark' });
  });

  it('drops one bad entry without losing the good ones alongside it', () => {
    const result = sanitizeUserPreferences({ autoScroll: 'true', decibelValue: 'loud' });
    expect(result).toEqual({ autoScroll: 'true' });
  });

  it('refuses anything that is not a plain object of strings', () => {
    expect(sanitizeUserPreferences(null)).toEqual({});
    expect(sanitizeUserPreferences('autoScroll=true')).toEqual({});
    expect(sanitizeUserPreferences([['autoScroll', 'true']])).toEqual({});
    expect(sanitizeUserPreferences({ autoScroll: true })).toEqual({});
    expect(sanitizeUserPreferences({ autoScroll: { value: 'true' } })).toEqual({});
  });

  it('cannot be used to reach inherited object properties', () => {
    expect(isUserPreferenceKey('toString')).toBe(false);
    expect(isUserPreferenceKey('constructor')).toBe(false);
    expect(sanitizeUserPreferences({ toString: 'true' })).toEqual({});
  });
});
