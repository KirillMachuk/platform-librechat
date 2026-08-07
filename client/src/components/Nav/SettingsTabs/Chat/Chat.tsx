import { memo } from 'react';
import { SettingGroup } from '@librechat/client';
import { showThinkingAtom } from '~/store/showThinking';
import FontSizeSelector from './FontSizeSelector';
import AdvancedPrompts from './AdvancedPrompts';
import ChatDirection from './ChatDirection';
import ToggleSwitch from '../ToggleSwitch';
import store from '~/store';

const toggleSwitchConfigs = [
  {
    stateAtom: store.alwaysMakeProd,
    localizationKey: 'com_nav_always_make_prod' as const,
    switchId: 'alwaysMakeProd',
    descriptionKey: undefined,
    key: 'alwaysMakeProd',
  },
  {
    stateAtom: store.autoSendPrompts,
    localizationKey: 'com_nav_auto_send_prompts' as const,
    switchId: 'autoSendPrompts',
    descriptionKey: 'com_nav_auto_send_prompts_desc' as const,
    key: 'autoSendPrompts',
  },
  {
    stateAtom: store.enterToSend,
    localizationKey: 'com_nav_enter_to_send' as const,
    switchId: 'enterToSend',
    descriptionKey: 'com_nav_enter_to_send_desc' as const,
    key: 'enterToSend',
  },
  {
    stateAtom: store.maximizeChatSpace,
    localizationKey: 'com_nav_maximize_chat_space' as const,
    switchId: 'maximizeChatSpace',
    descriptionKey: undefined,
    key: 'maximizeChatSpace',
  },
  {
    stateAtom: store.centerFormOnLanding,
    localizationKey: 'com_nav_center_chat_input' as const,
    switchId: 'centerFormOnLanding',
    descriptionKey: undefined,
    key: 'centerFormOnLanding',
  },
  {
    stateAtom: showThinkingAtom,
    localizationKey: 'com_nav_show_thinking' as const,
    switchId: 'showThinking',
    descriptionKey: 'com_nav_show_thinking_desc' as const,
    key: 'showThinking',
  },
  {
    stateAtom: store.autoExpandTools,
    localizationKey: 'com_nav_auto_expand_tools' as const,
    switchId: 'autoExpandTools',
    descriptionKey: undefined,
    key: 'autoExpandTools',
  },
  {
    stateAtom: store.LaTeXParsing,
    localizationKey: 'com_nav_latex_parsing' as const,
    switchId: 'latexParsing',
    descriptionKey: undefined,
    key: 'latexParsing',
  },
  {
    stateAtom: store.saveDrafts,
    localizationKey: 'com_nav_save_drafts' as const,
    switchId: 'saveDrafts',
    descriptionKey: 'com_nav_save_drafts_desc' as const,
    key: 'saveDrafts',
  },
  {
    stateAtom: store.showScrollButton,
    localizationKey: 'com_nav_scroll_button' as const,
    switchId: 'showScrollButton',
    descriptionKey: undefined,
    key: 'showScrollButton',
  },
  {
    stateAtom: store.saveBadgesState,
    localizationKey: 'com_nav_save_badges_state' as const,
    switchId: 'showBadges',
    descriptionKey: 'com_nav_save_badges_state_desc' as const,
    key: 'showBadges',
  },
  {
    stateAtom: store.modularChat,
    localizationKey: 'com_nav_modular_chat' as const,
    switchId: 'modularChat',
    descriptionKey: undefined,
    key: 'modularChat',
  },
  {
    stateAtom: store.defaultTemporaryChat,
    localizationKey: 'com_nav_default_temporary_chat' as const,
    switchId: 'defaultTemporaryChat',
    descriptionKey: 'com_nav_default_temporary_chat_desc' as const,
    key: 'defaultTemporaryChat',
  },
  {
    stateAtom: store.showPresetsMenu,
    localizationKey: 'com_nav_show_presets_menu' as const,
    switchId: 'showPresetsMenu',
    descriptionKey: 'com_nav_info_show_presets_menu' as const,
    key: 'showPresetsMenu',
  },
  {
    stateAtom: store.showParametersPanel,
    localizationKey: 'com_nav_show_parameters_panel' as const,
    switchId: 'showParametersPanel',
    descriptionKey: 'com_nav_info_show_parameters_panel' as const,
    key: 'showParametersPanel',
  },
  {
    stateAtom: store.showBookmarksMenu,
    localizationKey: 'com_nav_show_bookmarks_menu' as const,
    switchId: 'showBookmarksMenu',
    descriptionKey: 'com_nav_info_show_bookmarks_menu' as const,
    key: 'showBookmarksMenu',
  },
];

function Chat() {
  return (
    <div className="p-1 text-sm text-text-primary">
      <SettingGroup>
        <FontSizeSelector />
        <ChatDirection />
        {toggleSwitchConfigs.map((config) => (
          <ToggleSwitch
            key={config.key}
            stateAtom={config.stateAtom}
            localizationKey={config.localizationKey}
            descriptionKey={config.descriptionKey}
            switchId={config.switchId}
          />
        ))}
        <AdvancedPrompts />
      </SettingGroup>
    </div>
  );
}

export default memo(Chat);
