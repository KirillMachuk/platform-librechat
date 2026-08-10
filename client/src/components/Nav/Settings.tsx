import React, { useEffect, useState, useRef } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { PermissionTypes, Permissions, SettingsTabValues } from 'librechat-data-provider';
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from '@headlessui/react';
import {
  GearIcon,
  DataIcon,
  UserIcon,
  SpeechIcon,
  useMediaQuery,
  PersonalizationIcon,
} from '@librechat/client';
import type { TDialogProps } from '~/common';
import {
  General,
  Chat,
  Commands,
  Speech,
  Personalization,
  Memory,
  Data,
  Balance,
  Account,
  About,
} from './SettingsTabs';
import { Brain, Command, DollarSign, Info, MessageSquare, X } from '~/components/icons';
import usePersonalizationAccess from '~/hooks/usePersonalizationAccess';
import { useLocalize, useHasAccess, TranslationKeys } from '~/hooks';
import { useGetStartupConfig } from '~/data-provider';
import { cn } from '~/utils';

type SettingsTab = {
  value: SettingsTabValues;
  icon: React.JSX.Element;
  label: TranslationKeys;
  content: React.JSX.Element;
};

export default function Settings({ open, onOpenChange }: TDialogProps) {
  const isSmallScreen = useMediaQuery('(max-width: 767px)');
  const { data: startupConfig } = useGetStartupConfig();
  const localize = useLocalize();
  const [activeTab, setActiveTab] = useState(SettingsTabValues.GENERAL);
  const tabRefs = useRef({});
  const { hasAnyPersonalizationFeature, hasMemoryOptOut } = usePersonalizationAccess();
  const hasAccessToMemories = useHasAccess({
    permissionType: PermissionTypes.MEMORIES,
    permission: Permissions.USE,
  });
  const hasAccessToReadMemories = useHasAccess({
    permissionType: PermissionTypes.MEMORIES,
    permission: Permissions.READ,
  });
  const showMemoryTab = hasAccessToMemories && hasAccessToReadMemories;
  const aboutEnabled = startupConfig?.interface?.buildInfo !== false;

  useEffect(() => {
    if (!aboutEnabled && activeTab === SettingsTabValues.ABOUT) {
      setActiveTab(SettingsTabValues.GENERAL);
    }
  }, [aboutEnabled, activeTab]);

  /**
   * One array for the rail, the keyboard and the panels — canon forbids the
   * list and the rail drifting apart, and they used to be declared three times
   * over with the same permission gates copied into each.
   */
  const settingsTabs: SettingsTab[] = [
    {
      value: SettingsTabValues.GENERAL,
      icon: <GearIcon />,
      label: 'com_nav_setting_general',
      content: <General />,
    },
    {
      value: SettingsTabValues.CHAT,
      icon: <MessageSquare className="icon-sm" aria-hidden="true" />,
      label: 'com_nav_setting_chat',
      content: <Chat />,
    },
    {
      value: SettingsTabValues.COMMANDS,
      icon: <Command className="icon-sm" aria-hidden="true" />,
      label: 'com_nav_commands',
      content: <Commands />,
    },
    {
      value: SettingsTabValues.SPEECH,
      icon: <SpeechIcon className="icon-sm" aria-hidden="true" />,
      label: 'com_nav_setting_speech',
      content: <Speech />,
    },
    ...(hasAnyPersonalizationFeature
      ? [
          {
            value: SettingsTabValues.PERSONALIZATION,
            icon: <PersonalizationIcon />,
            label: 'com_nav_setting_personalization' as TranslationKeys,
            content: (
              <Personalization
                hasMemoryOptOut={hasMemoryOptOut}
                hasAnyPersonalizationFeature={hasAnyPersonalizationFeature}
              />
            ),
          },
        ]
      : []),
    ...(showMemoryTab
      ? [
          {
            value: SettingsTabValues.MEMORY,
            icon: <Brain className="icon-sm" aria-hidden="true" />,
            label: 'com_ui_memories' as TranslationKeys,
            content: <Memory />,
          },
        ]
      : []),
    {
      value: SettingsTabValues.DATA,
      icon: <DataIcon />,
      label: 'com_nav_setting_data',
      content: <Data />,
    },
    ...(startupConfig?.balance?.enabled
      ? [
          {
            value: SettingsTabValues.BALANCE,
            icon: <DollarSign size={18} />,
            label: 'com_nav_setting_balance' as TranslationKeys,
            content: <Balance />,
          },
        ]
      : ([] as SettingsTab[])),
    {
      value: SettingsTabValues.ACCOUNT,
      icon: <UserIcon />,
      label: 'com_nav_setting_account',
      content: <Account />,
    },
    ...(aboutEnabled
      ? [
          {
            value: SettingsTabValues.ABOUT,
            icon: <Info className="icon-sm" aria-hidden="true" />,
            label: 'com_nav_setting_about' as TranslationKeys,
            content: <About />,
          },
        ]
      : ([] as SettingsTab[])),
  ];

  const handleKeyDown = (event: React.KeyboardEvent) => {
    const tabs = settingsTabs.map(({ value }) => value);
    const currentIndex = tabs.indexOf(activeTab);

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveTab(tabs[(currentIndex + 1) % tabs.length]);
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveTab(tabs[(currentIndex - 1 + tabs.length) % tabs.length]);
        break;
      case 'Home':
        event.preventDefault();
        setActiveTab(tabs[0]);
        break;
      case 'End':
        event.preventDefault();
        setActiveTab(tabs[tabs.length - 1]);
        break;
    }
  };

  const handleTabChange = (value: string) => {
    setActiveTab(value as SettingsTabValues);
  };

  return (
    <Transition appear show={open}>
      {/* Same layer as PanelDialog: above the mobile drawer (110), below OGDialog (130/140). */}
      <Dialog as="div" className="relative z-dialog" onClose={onOpenChange}>
        <TransitionChild
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/80" aria-hidden="true" />
        </TransitionChild>

        <TransitionChild
          enter="ease-out duration-200"
          enterFrom="opacity-0 scale-95"
          enterTo="opacity-100 scale-100"
          leave="ease-in duration-100"
          leaveFrom="opacity-100 scale-100"
          leaveTo="opacity-0 scale-95"
        >
          <div className={cn('fixed inset-0 flex w-screen items-center justify-center p-4')}>
            <DialogPanel
              className={cn(
                'max-h-[90vh] overflow-hidden rounded-xl rounded-b-lg bg-background pb-6 shadow-lg backdrop-blur-2xl animate-in sm:rounded-2xl md:w-[840px]',
              )}
            >
              <DialogTitle
                className="mb-1 flex items-center justify-between p-6 pb-5 text-left"
                as="div"
              >
                <h2 className="text-lg font-medium leading-6 text-text-primary">
                  {localize('com_nav_settings')}
                </h2>
                <button
                  type="button"
                  className="rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-border-xheavy focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-surface-primary dark:focus:ring-offset-surface-primary"
                  onClick={() => onOpenChange(false)}
                >
                  <X className="icon-md text-text-primary" />
                  <span className="sr-only">{localize('com_ui_close_settings')}</span>
                </button>
              </DialogTitle>
              <div className="h-[600px] max-h-[calc(90vh-120px)] overflow-auto px-6 md:w-[840px]">
                <Tabs.Root
                  value={activeTab}
                  onValueChange={handleTabChange}
                  className="flex flex-col gap-10 md:flex-row"
                  orientation="vertical"
                >
                  <Tabs.List
                    aria-label={localize('com_ui_settings_sections')}
                    className={cn(
                      'min-w-auto max-w-auto relative -ml-[8px] flex flex-shrink-0 flex-col flex-nowrap overflow-auto sm:max-w-none',
                      isSmallScreen
                        ? 'flex-row rounded-xl bg-surface-secondary'
                        : 'sticky top-0 h-full',
                    )}
                    onKeyDown={handleKeyDown}
                  >
                    {settingsTabs.map(({ value, icon, label }) => (
                      <Tabs.Trigger
                        key={value}
                        className={cn(
                          /* Canon, prototype screens 21–23 (`.srail button`): 36
                             high, 14px label, radius 8, 0/10 padding, gap 10,
                             icon 16. The icon is sized here rather than on each
                             svg — five of them carry their own width/height. */
                          'group relative z-10 m-1 flex h-9 items-center justify-start gap-2.5 rounded-lg px-2.5 text-sm transition-all duration-200 ease-in-out [&>svg]:size-4 [&>svg]:shrink-0',
                          /* The selected section is the accent on its soft tint,
                             icon included — grey on grey is no distinction. The
                             icon's variants read `[&>svg]:` first and the state
                             second: the other order hangs `[data-state=active]`
                             on the svg, which never carries it. */
                          isSmallScreen
                            ? /* `whitespace-nowrap`, not `text-nowrap`: twMerge
                               files anything `text-*` it does not recognise as
                               a size under text COLOUR, so the real colour two
                               classes later dropped it and the phone rail wrapped
                               its labels. Same trap as `duration-[120ms]` — the
                               class survives the source and dies in the merge. */
                              'flex-1 justify-center whitespace-nowrap px-3 text-text-secondary radix-state-active:bg-ring-primary-soft radix-state-active:text-text-accent'
                            : 'bg-transparent text-text-primary radix-state-active:bg-ring-primary-soft radix-state-active:text-text-accent [&>svg]:text-text-secondary [&>svg]:radix-state-active:text-text-accent',
                        )}
                        value={value}
                        ref={(el) => (tabRefs.current[value] = el)}
                      >
                        {icon}
                        {localize(label)}
                      </Tabs.Trigger>
                    ))}
                  </Tabs.List>
                  <div className="overflow-auto sm:w-full sm:max-w-none md:pr-0.5 md:pt-0.5">
                    {settingsTabs.map(({ value, content }) => (
                      <Tabs.Content key={value} value={value} tabIndex={-1}>
                        {content}
                      </Tabs.Content>
                    ))}
                  </div>
                </Tabs.Root>
              </div>
            </DialogPanel>
          </div>
        </TransitionChild>
      </Dialog>
    </Transition>
  );
}
