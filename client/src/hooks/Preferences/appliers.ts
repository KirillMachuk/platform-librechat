import Cookies from 'js-cookie';
import { showThinkingAtom } from '~/store/showThinking';
import { fontSizeAtom } from '~/store/fontSize';
import { storePreference } from '~/utils/preferences';
import { mcpPinnedAtom } from '~/store/mcp';
import type { UserPreferenceKey } from 'librechat-data-provider';
import type { RecoilState } from 'recoil';
import type { useStore } from 'jotai';
import store from '~/store';

type JotaiStore = ReturnType<typeof useStore>;

/**
 * Applies one setting to the running interface.
 *
 * Writing browser storage is not enough on its own: a store that was already read — the
 * theme, or anything left over when a second employee signs in on the same computer —
 * keeps its old value until something sets it. Each applier therefore goes through the
 * live store, which persists the value on the way.
 */
export type PreferenceApplier = (raw: string, target: PreferenceTargets) => void;

export interface PreferenceTargets {
  setRecoil: <T>(state: RecoilState<T>, value: T) => void;
  jotai: JotaiStore;
  setTheme: (theme: string) => void;
}

const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

const asBoolean = (raw: string): boolean => parseJson(raw) === true;
const asNumber = (raw: string): number => Number(parseJson(raw));
const asString = (raw: string): string => {
  const parsed = parseJson(raw);
  return typeof parsed === 'string' ? parsed : '';
};

const recoilBoolean =
  (state: RecoilState<boolean>): PreferenceApplier =>
  (raw, { setRecoil }) =>
    setRecoil(state, asBoolean(raw));

const recoilNumber =
  (state: RecoilState<number>): PreferenceApplier =>
  (raw, { setRecoil }) =>
    setRecoil(state, asNumber(raw));

const recoilString =
  (state: RecoilState<string>): PreferenceApplier =>
  (raw, { setRecoil }) =>
    setRecoil(state, asString(raw));

/**
 * Settings held by a hook's own state rather than a shared store — the pinned-tool
 * flags — and the per-chat tool defaults read straight out of storage. Writing the
 * value re-raises a storage event, which is how those hooks learn about it.
 */
const storedOnly =
  (key: UserPreferenceKey): PreferenceApplier =>
  (raw) =>
    storePreference(key, raw);

export const preferenceAppliers: Record<UserPreferenceKey, PreferenceApplier> = {
  /** Settings → General */
  enableUserMsgMarkdown: recoilBoolean(store.enableUserMsgMarkdown),
  autoScroll: recoilBoolean(store.autoScroll),
  keepScreenAwake: recoilBoolean(store.keepScreenAwake),
  newChatSwitchToHistory: recoilBoolean(store.newChatSwitchToHistory),
  'color-theme': (raw, { setTheme }) => setTheme(raw),
  /** The cookie is a second home for this one: the server reads it to pick the language
   *  of what it renders itself, so restoring only the browser store would leave those
   *  strings in the previous device's language. */
  lang: (raw, { setRecoil }) => {
    const value = asString(raw);
    setRecoil(store.lang, value);
    Cookies.set('lang', value, { expires: 365 });
  },

  /** Settings → Chat */
  fontSize: (raw, { jotai }) => jotai.set(fontSizeAtom, asString(raw)),
  chatDirection: recoilString(store.chatDirection),
  alwaysMakeProd: recoilBoolean(store.alwaysMakeProd),
  autoSendPrompts: recoilBoolean(store.autoSendPrompts),
  enterToSend: recoilBoolean(store.enterToSend),
  maximizeChatSpace: recoilBoolean(store.maximizeChatSpace),
  centerFormOnLanding: recoilBoolean(store.centerFormOnLanding),
  showThinking: (raw, { jotai }) => jotai.set(showThinkingAtom, asBoolean(raw)),
  autoExpandTools: recoilBoolean(store.autoExpandTools),
  LaTeXParsing: recoilBoolean(store.LaTeXParsing),
  saveDrafts: recoilBoolean(store.saveDrafts),
  showScrollButton: recoilBoolean(store.showScrollButton),
  saveBadgesState: recoilBoolean(store.saveBadgesState),
  modularChat: recoilBoolean(store.modularChat),
  defaultTemporaryChat: recoilBoolean(store.defaultTemporaryChat),
  showPresetsMenu: recoilBoolean(store.showPresetsMenu),
  showParametersPanel: recoilBoolean(store.showParametersPanel),
  showBookmarksMenu: recoilBoolean(store.showBookmarksMenu),

  /** Settings → Commands */
  atCommand: recoilBoolean(store.atCommand),
  plusCommand: recoilBoolean(store.plusCommand),
  slashCommand: recoilBoolean(store.slashCommand),
  dollarCommand: recoilBoolean(store.dollarCommand),

  /** Settings → Speech */
  conversationMode: recoilBoolean(store.conversationMode),
  advancedMode: recoilBoolean(store.advancedMode),
  speechToText: recoilBoolean(store.speechToText),
  engineSTT: recoilString(store.engineSTT),
  languageSTT: recoilString(store.languageSTT),
  autoTranscribeAudio: recoilBoolean(store.autoTranscribeAudio),
  decibelValue: recoilNumber(store.decibelValue),
  autoSendText: recoilNumber(store.autoSendText),
  textToSpeech: recoilBoolean(store.textToSpeech),
  engineTTS: recoilString(store.engineTTS),
  voice: (raw, { setRecoil }) => setRecoil(store.voice, asString(raw)),
  cloudBrowserVoices: recoilBoolean(store.cloudBrowserVoices),
  languageTTS: recoilString(store.languageTTS),
  automaticPlayback: recoilBoolean(store.automaticPlayback),
  playbackRate: (raw, { setRecoil }) => setRecoil(store.playbackRate, asNumber(raw)),
  cacheTTS: recoilBoolean(store.cacheTTS),

  /** Settings → Account */
  UsernameDisplay: recoilBoolean(store.UsernameDisplay),

  /** Tools pinned to the row under the message box */
  LAST_CODE_TOGGLE_pinned: storedOnly('LAST_CODE_TOGGLE_pinned'),
  LAST_WEB_SEARCH_TOGGLE_pinned: storedOnly('LAST_WEB_SEARCH_TOGGLE_pinned'),
  LAST_DEEP_RESEARCH_TOGGLE_pinned: storedOnly('LAST_DEEP_RESEARCH_TOGGLE_pinned'),
  LAST_FILE_SEARCH_TOGGLE_pinned: storedOnly('LAST_FILE_SEARCH_TOGGLE_pinned'),
  LAST_ARTIFACTS_TOGGLE_pinned: storedOnly('LAST_ARTIFACTS_TOGGLE_pinned'),
  LAST_SKILLS_TOGGLE_pinned: storedOnly('LAST_SKILLS_TOGGLE_pinned'),
  PIN_MCP_: (raw, { jotai }) => jotai.set(mcpPinnedAtom, asBoolean(raw)),

  /** Which tools a brand-new chat starts with */
  LAST_CODE_TOGGLE_new: storedOnly('LAST_CODE_TOGGLE_new'),
  LAST_WEB_SEARCH_TOGGLE_new: storedOnly('LAST_WEB_SEARCH_TOGGLE_new'),
  LAST_DEEP_RESEARCH_TOGGLE_new: storedOnly('LAST_DEEP_RESEARCH_TOGGLE_new'),
  LAST_FILE_SEARCH_TOGGLE_new: storedOnly('LAST_FILE_SEARCH_TOGGLE_new'),
  LAST_SKILLS_TOGGLE_new: storedOnly('LAST_SKILLS_TOGGLE_new'),
  LAST_ARTIFACTS_TOGGLE_new: storedOnly('LAST_ARTIFACTS_TOGGLE_new'),
};
