import React, { useContext, useCallback } from 'react';
import Cookies from 'js-cookie';
import { useRecoilState, useRecoilValue } from 'recoil';
import { Dropdown, Spinner, ThemeContext, SettingRow, SettingGroup } from '@librechat/client';
import ArchivedChats from './ArchivedChats';
import ToggleSwitch from '../ToggleSwitch';
import { useLocalize } from '~/hooks';
import store from '~/store';

const toggleSwitchConfigs = [
  {
    stateAtom: store.enableUserMsgMarkdown,
    localizationKey: 'com_nav_user_msg_markdown' as const,
    switchId: 'enableUserMsgMarkdown',
    descriptionKey: 'com_nav_user_msg_markdown_desc' as const,
    key: 'enableUserMsgMarkdown',
  },
  {
    stateAtom: store.autoScroll,
    localizationKey: 'com_nav_auto_scroll' as const,
    switchId: 'autoScroll',
    descriptionKey: undefined,
    key: 'autoScroll',
  },
  {
    stateAtom: store.keepScreenAwake,
    localizationKey: 'com_nav_keep_screen_awake' as const,
    switchId: 'keepScreenAwake',
    descriptionKey: undefined,
    key: 'keepScreenAwake',
  },
  {
    stateAtom: store.newChatSwitchToHistory,
    localizationKey: 'com_nav_new_chat_switch_to_history' as const,
    switchId: 'newChatSwitchToHistory',
    descriptionKey: undefined,
    key: 'newChatSwitchToHistory',
  },
];

export const ThemeSelector = ({
  theme,
  onChange,
  portal = true,
}: {
  theme: string;
  onChange: (value: string) => void;
  portal?: boolean;
}) => {
  const localize = useLocalize();

  const themeOptions = [
    { value: 'system', label: localize('com_nav_theme_system') },
    { value: 'dark', label: localize('com_nav_theme_dark') },
    { value: 'light', label: localize('com_nav_theme_light') },
  ];

  return (
    <SettingRow
      id="theme-selector"
      title={localize('com_nav_theme')}
      control={({ labelId }) => (
        <Dropdown
          value={theme}
          onChange={onChange}
          options={themeOptions}
          sizeClasses="w-[180px]"
          testId="theme-selector"
          aria-labelledby={labelId}
          portal={portal}
        />
      )}
    />
  );
};

export const LangSelector = ({
  langcode,
  onChange,
  portal = true,
}: {
  langcode: string;
  onChange: (value: string) => void;
  portal?: boolean;
}) => {
  const localize = useLocalize();
  const isLanguageLoading = useRecoilValue(store.languageLoading);

  const languageOptions = [
    { value: 'auto', label: localize('com_nav_lang_auto') },
    { value: 'en-US', label: localize('com_nav_lang_english') },
    { value: 'zh-Hans', label: localize('com_nav_lang_chinese') },
    { value: 'zh-Hant', label: localize('com_nav_lang_traditional_chinese') },
    { value: 'ar-EG', label: localize('com_nav_lang_arabic') },
    { value: 'bs', label: localize('com_nav_lang_bosnian') },
    { value: 'da-DK', label: localize('com_nav_lang_danish') },
    { value: 'de-DE', label: localize('com_nav_lang_german') },
    { value: 'es-ES', label: localize('com_nav_lang_spanish') },
    { value: 'ca-ES', label: localize('com_nav_lang_catalan') },
    { value: 'et-EE', label: localize('com_nav_lang_estonian') },
    { value: 'fa-IR', label: localize('com_nav_lang_persian') },
    { value: 'fr-FR', label: localize('com_nav_lang_french') },
    { value: 'he-HE', label: localize('com_nav_lang_hebrew') },
    { value: 'hu-HU', label: localize('com_nav_lang_hungarian') },
    { value: 'hy-AM', label: localize('com_nav_lang_armenian') },
    { value: 'is', label: localize('com_nav_lang_icelandic') },
    { value: 'it-IT', label: localize('com_nav_lang_italian') },
    { value: 'nb', label: localize('com_nav_lang_norwegian_bokmal') },
    { value: 'nn', label: localize('com_nav_lang_norwegian_nynorsk') },
    { value: 'pl-PL', label: localize('com_nav_lang_polish') },
    { value: 'pt-BR', label: localize('com_nav_lang_brazilian_portuguese') },
    { value: 'pt-PT', label: localize('com_nav_lang_portuguese') },
    { value: 'ru-RU', label: localize('com_nav_lang_russian') },
    { value: 'sk', label: localize('com_nav_lang_slovak') },
    { value: 'ja-JP', label: localize('com_nav_lang_japanese') },
    { value: 'ka-GE', label: localize('com_nav_lang_georgian') },
    { value: 'cs-CZ', label: localize('com_nav_lang_czech') },
    { value: 'sv-SE', label: localize('com_nav_lang_swedish') },
    { value: 'ko-KR', label: localize('com_nav_lang_korean') },
    { value: 'lt-LT', label: localize('com_nav_lang_lithuanian') },
    { value: 'lv-LV', label: localize('com_nav_lang_latvian') },
    { value: 'vi-VN', label: localize('com_nav_lang_vietnamese') },
    { value: 'th-TH', label: localize('com_nav_lang_thai') },
    { value: 'tr-TR', label: localize('com_nav_lang_turkish') },
    { value: 'ug', label: localize('com_nav_lang_uyghur') },
    { value: 'nl-NL', label: localize('com_nav_lang_dutch') },
    { value: 'id-ID', label: localize('com_nav_lang_indonesia') },
    { value: 'fi-FI', label: localize('com_nav_lang_finnish') },
    { value: 'sl', label: localize('com_nav_lang_slovenian') },
    { value: 'bo', label: localize('com_nav_lang_tibetan') },
    { value: 'uk-UA', label: localize('com_nav_lang_ukrainian') },
  ];

  return (
    <SettingRow
      id="language-selector"
      title={localize('com_nav_language')}
      control={({ labelId }) => (
        <div className="flex items-center gap-2">
          {isLanguageLoading && (
            <span
              role="status"
              aria-label={localize('com_ui_loading')}
              className="flex size-5 items-center justify-center text-text-secondary"
            >
              <Spinner className="size-4" />
            </span>
          )}
          <Dropdown
            value={langcode}
            onChange={onChange}
            sizeClasses="[--anchor-max-height:256px] max-h-[60vh]"
            options={languageOptions}
            aria-labelledby={labelId}
            portal={portal}
          />
        </div>
      )}
    />
  );
};

function General() {
  const { theme, setTheme } = useContext(ThemeContext);

  const [langcode, setLangcode] = useRecoilState(store.lang);

  const changeTheme = useCallback(
    (value: string) => {
      setTheme(value);
    },
    [setTheme],
  );

  const changeLang = useCallback(
    (value: string) => {
      let userLang = value;
      if (value === 'auto') {
        userLang = navigator.language || navigator.languages[0];
      }

      setLangcode(userLang);
      Cookies.set('lang', userLang, { expires: 365 });
    },
    [setLangcode],
  );

  return (
    <div className="p-1 text-sm text-text-primary">
      <SettingGroup>
        <ThemeSelector theme={theme} onChange={changeTheme} />
        <LangSelector langcode={langcode} onChange={changeLang} />
        {toggleSwitchConfigs.map((config) => (
          <ToggleSwitch
            key={config.key}
            stateAtom={config.stateAtom}
            localizationKey={config.localizationKey}
            descriptionKey={config.descriptionKey}
            switchId={config.switchId}
          />
        ))}
        <ArchivedChats />
      </SettingGroup>
    </div>
  );
}

export default React.memo(General);
