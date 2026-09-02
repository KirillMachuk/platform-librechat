import { Constants, LocalStorageKeys } from './config';
import { ArtifactModes } from './artifacts';

/**
 * Personal interface settings that belong to the person rather than to the browser
 * they happen to be sitting at. Everything listed here is mirrored to the account so
 * a new device, a cleared cache or a shared workstation still shows each employee
 * their own setup.
 *
 * Deliberately NOT listed: state that describes a device rather than a person
 * (sidebar expansion, which defaults differently on a phone), state that belongs to
 * one conversation (per-conversation tool toggles, drafts), and dismissed-banner
 * bookkeeping.
 */

export type PreferenceValueType = 'boolean' | 'number' | 'string';

/** `json` values are `JSON.stringify`d in browser storage, `raw` ones are stored bare. */
export type PreferenceStorageFormat = 'json' | 'raw';

export interface UserPreferenceDefinition {
  type: PreferenceValueType;
  /** Defaults to `json` — the format used by every store helper except the theme. */
  format?: PreferenceStorageFormat;
  /** Closed set of accepted values for a string preference. */
  values?: readonly string[];
  /** Cap for a free-form string preference. */
  maxLength?: number;
  /**
   * Browser storage expires this entry unless a companion `<key>_TIMESTAMP` is kept
   * fresh, so restoring the value alone would leave it to be swept on the next start.
   */
  timestamped?: boolean;
}

const THEME_MODES = ['light', 'dark', 'system'] as const;
const FONT_SIZES = ['text-xs', 'text-sm', 'text-base', 'text-lg', 'text-xl'] as const;
const CHAT_DIRECTIONS = ['LTR', 'RTL'] as const;
const SPEECH_ENGINES = ['browser', 'external', 'openai', 'azureOpenAI'] as const;
const ARTIFACT_MODES = [
  '',
  ArtifactModes.DEFAULT,
  ArtifactModes.SHADCNUI,
  ArtifactModes.CUSTOM,
] as const;

/** Longest accepted stored value; the widest real entry is a voice identifier. */
export const MAX_PREFERENCE_VALUE_LENGTH = 256;

const BOOLEAN: UserPreferenceDefinition = { type: 'boolean' };
const NUMBER: UserPreferenceDefinition = { type: 'number' };
const TOGGLE: UserPreferenceDefinition = { type: 'boolean', timestamped: true };
const LOCALE: UserPreferenceDefinition = { type: 'string', maxLength: 32 };

export const userPreferenceDefinitions = {
  /** Settings → General */
  [`${LocalStorageKeys.ENABLE_USER_MSG_MARKDOWN}`]: BOOLEAN,
  autoScroll: BOOLEAN,
  keepScreenAwake: BOOLEAN,
  newChatSwitchToHistory: BOOLEAN,
  'color-theme': { type: 'string', format: 'raw', values: THEME_MODES },
  lang: LOCALE,

  /** Settings → Chat */
  fontSize: { type: 'string', values: FONT_SIZES },
  chatDirection: { type: 'string', values: CHAT_DIRECTIONS },
  alwaysMakeProd: BOOLEAN,
  autoSendPrompts: BOOLEAN,
  enterToSend: BOOLEAN,
  maximizeChatSpace: BOOLEAN,
  centerFormOnLanding: BOOLEAN,
  showThinking: BOOLEAN,
  /** «Запускать исследование сразу» (r30) — a person's choice, not a device's. */
  drAutoStart: BOOLEAN,
  [`${LocalStorageKeys.AUTO_EXPAND_TOOLS}`]: BOOLEAN,
  LaTeXParsing: BOOLEAN,
  saveDrafts: BOOLEAN,
  showScrollButton: BOOLEAN,
  saveBadgesState: BOOLEAN,
  modularChat: BOOLEAN,
  defaultTemporaryChat: BOOLEAN,
  showPresetsMenu: BOOLEAN,
  showParametersPanel: BOOLEAN,
  showBookmarksMenu: BOOLEAN,

  /** Settings → Commands */
  atCommand: BOOLEAN,
  plusCommand: BOOLEAN,
  slashCommand: BOOLEAN,
  dollarCommand: BOOLEAN,

  /** Settings → Speech */
  conversationMode: BOOLEAN,
  advancedMode: BOOLEAN,
  speechToText: BOOLEAN,
  engineSTT: { type: 'string', values: SPEECH_ENGINES },
  languageSTT: LOCALE,
  autoTranscribeAudio: BOOLEAN,
  decibelValue: NUMBER,
  autoSendText: NUMBER,
  textToSpeech: BOOLEAN,
  engineTTS: { type: 'string', values: SPEECH_ENGINES },
  voice: { type: 'string', maxLength: MAX_PREFERENCE_VALUE_LENGTH },
  cloudBrowserVoices: BOOLEAN,
  languageTTS: LOCALE,
  automaticPlayback: BOOLEAN,
  playbackRate: NUMBER,
  cacheTTS: BOOLEAN,

  /** Settings → Account */
  UsernameDisplay: BOOLEAN,

  /** Tools pinned to the row under the message box */
  [`${LocalStorageKeys.LAST_CODE_TOGGLE_}pinned`]: BOOLEAN,
  [`${LocalStorageKeys.LAST_WEB_SEARCH_TOGGLE_}pinned`]: BOOLEAN,
  [`${LocalStorageKeys.LAST_DEEP_RESEARCH_TOGGLE_}pinned`]: BOOLEAN,
  [`${LocalStorageKeys.LAST_FILE_SEARCH_TOGGLE_}pinned`]: BOOLEAN,
  [`${LocalStorageKeys.LAST_ARTIFACTS_TOGGLE_}pinned`]: BOOLEAN,
  [`${LocalStorageKeys.LAST_SKILLS_TOGGLE_}pinned`]: BOOLEAN,
  [`${LocalStorageKeys.PIN_MCP_}`]: BOOLEAN,

  /** Which tools a brand-new chat starts with */
  [`${LocalStorageKeys.LAST_CODE_TOGGLE_}${Constants.NEW_CONVO}`]: TOGGLE,
  [`${LocalStorageKeys.LAST_WEB_SEARCH_TOGGLE_}${Constants.NEW_CONVO}`]: TOGGLE,
  [`${LocalStorageKeys.LAST_DEEP_RESEARCH_TOGGLE_}${Constants.NEW_CONVO}`]: TOGGLE,
  [`${LocalStorageKeys.LAST_FILE_SEARCH_TOGGLE_}${Constants.NEW_CONVO}`]: TOGGLE,
  [`${LocalStorageKeys.LAST_SKILLS_TOGGLE_}${Constants.NEW_CONVO}`]: TOGGLE,
  [`${LocalStorageKeys.LAST_ARTIFACTS_TOGGLE_}${Constants.NEW_CONVO}`]: {
    type: 'string',
    values: ARTIFACT_MODES,
    timestamped: true,
  },
} as const satisfies Record<string, UserPreferenceDefinition>;

export type UserPreferenceKey = keyof typeof userPreferenceDefinitions;

/**
 * Preferences as they travel between browser and account: each value is exactly the
 * string the browser stores, so a round trip cannot reshape it.
 */
export type TUserPreferences = Partial<Record<UserPreferenceKey, string>>;

export const userPreferenceKeys = Object.keys(userPreferenceDefinitions) as UserPreferenceKey[];

export function isUserPreferenceKey(key: string): key is UserPreferenceKey {
  return Object.prototype.hasOwnProperty.call(userPreferenceDefinitions, key);
}

export function getPreferenceDefinition(key: UserPreferenceKey): UserPreferenceDefinition {
  return userPreferenceDefinitions[key];
}

function parseStoredValue(
  definition: UserPreferenceDefinition,
  stored: string,
): boolean | number | string | undefined {
  if (definition.format === 'raw') {
    return stored;
  }
  try {
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed === 'boolean' || typeof parsed === 'number' || typeof parsed === 'string') {
      return parsed;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether a stored string is something this preference is allowed to hold. Applied on
 * the way in (so the account cannot be filled with junk) and on the way out (so a value
 * left by an older build cannot break the interface it is applied to).
 */
export function isValidPreferenceValue(key: UserPreferenceKey, stored: string): boolean {
  if (typeof stored !== 'string' || stored.length > MAX_PREFERENCE_VALUE_LENGTH) {
    return false;
  }

  const definition = getPreferenceDefinition(key);
  const value = parseStoredValue(definition, stored);

  if (definition.type === 'boolean') {
    return typeof value === 'boolean';
  }

  if (definition.type === 'number') {
    return typeof value === 'number' && Number.isFinite(value);
  }

  if (typeof value !== 'string') {
    return false;
  }
  if (definition.values) {
    return (definition.values as readonly string[]).includes(value);
  }
  return value.length <= (definition.maxLength ?? MAX_PREFERENCE_VALUE_LENGTH);
}

/**
 * Reduces arbitrary input to the preferences this build recognises. Unknown keys and
 * values that fail their definition are dropped rather than rejected: one stale entry
 * from an older client must not cost the user the rest of their settings.
 */
export function sanitizeUserPreferences(input: unknown): TUserPreferences {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return {};
  }

  const sanitized: TUserPreferences = {};

  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value !== 'string' || !isUserPreferenceKey(key)) {
      continue;
    }
    if (!isValidPreferenceValue(key, value)) {
      continue;
    }
    sanitized[key] = value;
  }

  return sanitized;
}
