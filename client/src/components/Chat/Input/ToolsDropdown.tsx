import React, { useState, useMemo, useCallback } from 'react';
import * as Ariakit from '@ariakit/react';
import { TooltipAnchor, DropdownPopup, PinIcon, VectorIcon } from '@librechat/client';
import {
  Globe,
  ScrollText,
  Settings,
  Settings2,
  TerminalSquareIcon,
  Telescope,
} from 'lucide-react';
import {
  AuthType,
  Permissions,
  ArtifactModes,
  PermissionTypes,
  defaultAgentCapabilities,
} from 'librechat-data-provider';
import type { MenuItemProps } from '~/common';
import { useLocalize, useHasAccess, useAgentCapabilities } from '~/hooks';
import ArtifactsSubMenu from '~/components/Chat/Input/ArtifactsSubMenu';
import MCPSubMenu from '~/components/Chat/Input/MCPSubMenu';
import { useGetStartupConfig } from '~/data-provider';
import { useBadgeRowContext } from '~/Providers';
import { cn } from '~/utils';

interface ToolsDropdownProps {
  disabled?: boolean;
}

const ToolsDropdown = ({ disabled }: ToolsDropdownProps) => {
  const localize = useLocalize();
  const context = useBadgeRowContext();
  const { data: startupConfig } = useGetStartupConfig();

  const {
    codeEnabled,
    webSearchEnabled,
    deepResearchEnabled,
    artifactsEnabled,
    fileSearchEnabled,
    skillsEnabled,
  } = useAgentCapabilities(context?.agentsConfig?.capabilities ?? defaultAgentCapabilities);

  const canUseWebSearch = useHasAccess({
    permissionType: PermissionTypes.WEB_SEARCH,
    permission: Permissions.USE,
  });

  const canUseDeepResearch = useHasAccess({
    permissionType: PermissionTypes.DEEP_RESEARCH,
    permission: Permissions.USE,
  });

  const canRunCode = useHasAccess({
    permissionType: PermissionTypes.RUN_CODE,
    permission: Permissions.USE,
  });

  const canUseFileSearch = useHasAccess({
    permissionType: PermissionTypes.FILE_SEARCH,
    permission: Permissions.USE,
  });

  const canUseMcp = useHasAccess({
    permissionType: PermissionTypes.MCP_SERVERS,
    permission: Permissions.USE,
  });

  const canUseSkills = useHasAccess({
    permissionType: PermissionTypes.SKILLS,
    permission: Permissions.USE,
  });

  const [isPopoverActive, setIsPopoverActive] = useState(false);
  const isDisabled = disabled ?? false;
  const {
    skills,
    webSearch,
    deepResearch,
    artifacts,
    fileSearch,
    mcpServerManager,
    codeInterpreter,
    searchApiKeyForm,
    toolLoopUnavailable,
    activeModel,
  } = context ?? {};
  /** A model that runs chat-only — reasoning family, or no `tools` in its
   *  gateway's catalogue — omits the toggles that arm the tool loop (the backend
   *  drops them too). Deep Research and Artifacts remain, mirroring the badge
   *  row: DR runs on its own models and Artifacts is not a tool. */
  const toolLoopAvailable = !toolLoopUnavailable;

  const { setIsDialogOpen: setIsSearchDialogOpen, menuTriggerRef: searchMenuTriggerRef } =
    searchApiKeyForm ?? {};
  const {
    isPinned: isSearchPinned,
    setIsPinned: setIsSearchPinned,
    authData: webSearchAuthData,
  } = webSearch ?? {};
  const { isPinned: isDeepResearchPinned, setIsPinned: setIsDeepResearchPinned } =
    deepResearch ?? {};
  const { isPinned: isCodePinned, setIsPinned: setIsCodePinned } = codeInterpreter ?? {};
  const { isPinned: isFileSearchPinned, setIsPinned: setIsFileSearchPinned } = fileSearch ?? {};
  const { isPinned: isArtifactsPinned, setIsPinned: setIsArtifactsPinned } = artifacts ?? {};
  const { isPinned: isSkillsPinned, setIsPinned: setIsSkillsPinned } = skills ?? {};

  const showWebSearchSettings = useMemo(() => {
    const authTypes = webSearchAuthData?.authTypes ?? [];
    if (authTypes.length === 0) return true;
    return !authTypes.every(([, authType]) => authType === AuthType.SYSTEM_DEFINED);
  }, [webSearchAuthData?.authTypes]);

  const handleWebSearchToggle = useCallback(() => {
    const newValue = !webSearch?.toggleState;
    webSearch?.debouncedChange({ value: newValue });
  }, [webSearch]);

  const handleDeepResearchToggle = useCallback(() => {
    const newValue = !deepResearch?.toggleState;
    deepResearch?.debouncedChange({ value: newValue });
  }, [deepResearch]);

  const handleCodeInterpreterToggle = useCallback(() => {
    const newValue = !codeInterpreter?.toggleState;
    codeInterpreter?.debouncedChange({ value: newValue });
  }, [codeInterpreter]);

  const handleFileSearchToggle = useCallback(() => {
    const newValue = !fileSearch?.toggleState;
    fileSearch?.debouncedChange({ value: newValue });
  }, [fileSearch]);

  const handleArtifactsToggle = useCallback(() => {
    const currentState = artifacts?.toggleState;
    if (!currentState || currentState === '') {
      artifacts?.debouncedChange({ value: ArtifactModes.DEFAULT });
    } else {
      artifacts?.debouncedChange({ value: '' });
    }
  }, [artifacts]);

  const handleShadcnToggle = useCallback(() => {
    const currentState = artifacts?.toggleState;
    if (currentState === ArtifactModes.SHADCNUI) {
      artifacts?.debouncedChange({ value: ArtifactModes.DEFAULT });
    } else {
      artifacts?.debouncedChange({ value: ArtifactModes.SHADCNUI });
    }
  }, [artifacts]);

  const handleCustomToggle = useCallback(() => {
    const currentState = artifacts?.toggleState;
    if (currentState === ArtifactModes.CUSTOM) {
      artifacts?.debouncedChange({ value: ArtifactModes.DEFAULT });
    } else {
      artifacts?.debouncedChange({ value: ArtifactModes.CUSTOM });
    }
  }, [artifacts]);

  const handleSkillsToggle = useCallback(() => {
    const newValue = !skills?.toggleState;
    skills?.debouncedChange({ value: newValue });
  }, [skills]);

  const mcpPlaceholder = startupConfig?.interface?.mcpServers?.placeholder;

  const dropdownItems: MenuItemProps[] = [];

  if (fileSearchEnabled && canUseFileSearch && toolLoopAvailable) {
    dropdownItems.push({
      onClick: handleFileSearchToggle,
      hideOnClick: false,
      render: (props) => (
        <div {...props}>
          <div className="flex items-center gap-2">
            <VectorIcon className="icon-md" />
            <span>{localize('com_assistants_file_search')}</span>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsFileSearchPinned?.(!isFileSearchPinned);
            }}
            className={cn(
              'rounded p-1 transition-all duration-200',
              'hover:bg-surface-secondary hover:shadow-sm',
              !isFileSearchPinned && 'text-text-secondary hover:text-text-primary',
            )}
            aria-label={isFileSearchPinned ? localize('com_ui_unpin') : localize('com_ui_pin')}
          >
            <div className="h-4 w-4">
              <PinIcon unpin={isFileSearchPinned} />
            </div>
          </button>
        </div>
      ),
    });
  }

  if (canUseWebSearch && webSearchEnabled && toolLoopAvailable) {
    dropdownItems.push({
      onClick: handleWebSearchToggle,
      hideOnClick: false,
      render: (props) => (
        <div {...props}>
          <div className="flex items-center gap-2">
            <Globe className="icon-md" aria-hidden="true" />
            <span>{localize('com_ui_web_search')}</span>
          </div>
          <div className="flex items-center gap-1">
            {showWebSearchSettings && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsSearchDialogOpen?.(true);
                }}
                className={cn(
                  'rounded p-1 transition-all duration-200',
                  'hover:bg-surface-secondary hover:shadow-sm',
                  'text-text-secondary hover:text-text-primary',
                )}
                aria-label={localize('com_ui_web_search_configure')}
                ref={searchMenuTriggerRef}
              >
                <div className="h-4 w-4">
                  <Settings className="h-4 w-4" aria-hidden="true" />
                </div>
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsSearchPinned?.(!isSearchPinned);
              }}
              className={cn(
                'rounded p-1 transition-all duration-200',
                'hover:bg-surface-secondary hover:shadow-sm',
                !isSearchPinned && 'text-text-secondary hover:text-text-primary',
              )}
              aria-label={isSearchPinned ? localize('com_ui_unpin') : localize('com_ui_pin')}
            >
              <div className="h-4 w-4">
                <PinIcon unpin={isSearchPinned} />
              </div>
            </button>
          </div>
        </div>
      ),
    });
  }

  /** Mirrors the server admission gate: research takes web search AND its own permission.
   *  `interface.deepResearch` seeds the latter at startup, so checking the flag here as
   *  well would override whatever an admin later set on the role. */
  if (canUseWebSearch && canUseDeepResearch && deepResearchEnabled) {
    dropdownItems.push({
      onClick: handleDeepResearchToggle,
      hideOnClick: false,
      render: (props) => (
        <div {...props} data-testid="tools-menu-deep-research">
          <div className="flex items-center gap-2">
            <Telescope className="icon-md" aria-hidden="true" />
            <span>{localize('com_ui_deep_research')}</span>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsDeepResearchPinned?.(!isDeepResearchPinned);
            }}
            className={cn(
              'rounded p-1 transition-all duration-200',
              'hover:bg-surface-secondary hover:shadow-sm',
              !isDeepResearchPinned && 'text-text-secondary hover:text-text-primary',
            )}
            aria-label={isDeepResearchPinned ? localize('com_ui_unpin') : localize('com_ui_pin')}
          >
            <div className="h-4 w-4">
              <PinIcon unpin={isDeepResearchPinned} />
            </div>
          </button>
        </div>
      ),
    });
  }

  if (canUseSkills && skillsEnabled) {
    dropdownItems.push({
      onClick: handleSkillsToggle,
      hideOnClick: false,
      render: (props) => (
        <div {...props} data-testid="tools-menu-skills">
          <div className="flex items-center gap-2">
            <ScrollText className="icon-md" aria-hidden="true" />
            <span>{localize('com_ui_skills')}</span>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsSkillsPinned?.(!isSkillsPinned);
            }}
            className={cn(
              'rounded p-1 transition-all duration-200',
              'hover:bg-surface-secondary hover:shadow-sm',
              !isSkillsPinned && 'text-text-secondary hover:text-text-primary',
            )}
            aria-label={isSkillsPinned ? localize('com_ui_unpin') : localize('com_ui_pin')}
          >
            <div className="h-4 w-4">
              <PinIcon unpin={isSkillsPinned} />
            </div>
          </button>
        </div>
      ),
    });
  }

  if (canRunCode && codeEnabled && toolLoopAvailable) {
    dropdownItems.push({
      onClick: handleCodeInterpreterToggle,
      hideOnClick: false,
      render: (props) => (
        <div {...props}>
          <div className="flex items-center gap-2">
            <TerminalSquareIcon className="icon-md" aria-hidden="true" />
            <span>{localize('com_ui_run_code')}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsCodePinned?.(!isCodePinned);
              }}
              className={cn(
                'rounded p-1 transition-all duration-200',
                'hover:bg-surface-secondary hover:shadow-sm',
                !isCodePinned && 'text-text-primary hover:text-text-primary',
              )}
              aria-label={isCodePinned ? localize('com_ui_unpin') : localize('com_ui_pin')}
            >
              <div className="h-4 w-4">
                <PinIcon unpin={isCodePinned} />
              </div>
            </button>
          </div>
        </div>
      ),
    });
  }

  if (artifactsEnabled && setIsArtifactsPinned != null) {
    dropdownItems.push({
      hideOnClick: false,
      render: (props) => (
        <ArtifactsSubMenu
          {...props}
          isArtifactsPinned={isArtifactsPinned ?? false}
          setIsArtifactsPinned={setIsArtifactsPinned}
          artifactsMode={artifacts?.toggleState as string}
          handleArtifactsToggle={handleArtifactsToggle}
          handleShadcnToggle={handleShadcnToggle}
          handleCustomToggle={handleCustomToggle}
        />
      ),
    });
  }

  const { availableMCPServers } = mcpServerManager ?? {};
  if (canUseMcp && availableMCPServers && availableMCPServers.length > 0 && toolLoopAvailable) {
    dropdownItems.push({
      hideOnClick: false,
      render: (props) => <MCPSubMenu {...props} placeholder={mcpPlaceholder} />,
    });
  }

  /** A reasoning model hides every tool toggle above, which on its own reads as "the tools
   *  vanished" — and if a toggle was left on under a previous model, the user then watches
   *  that model answer "I have no access to your library". Say why, and name the model so it
   *  is clear that switching models brings the tools back. Non-interactive: nothing to click.
   *
   *  The width cap is load-bearing: the menu is an Ariakit popover sized `width: max-content`,
   *  so one long unbreakable line stretches the WHOLE menu — measured at 1104px on a 375px
   *  phone, which pushed every pin button off-screen. Capping the row makes the sentence wrap
   *  instead, and `--popover-available-width` keeps it inside the viewport on a narrow screen. */
  if (toolLoopUnavailable) {
    dropdownItems.push({
      disabled: true,
      hideOnClick: false,
      render: (props) => (
        <div
          {...props}
          className="max-w-[min(18rem,var(--popover-available-width,18rem))] whitespace-normal break-words px-3 py-2 text-sm text-text-secondary"
        >
          {localize('com_ui_tools_unavailable_model')}
          {activeModel ? <span className="mt-0.5 block opacity-70">{activeModel}</span> : null}
        </div>
      ),
    });
  }

  if (dropdownItems.length === 0) {
    return null;
  }

  const menuTrigger = (
    <TooltipAnchor
      render={
        <Ariakit.MenuButton
          disabled={isDisabled}
          id="tools-dropdown-button"
          aria-label={localize('com_ui_tools_options')}
          className={cn(
            'flex size-9 items-center justify-center rounded-full p-1 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-opacity-50',
            isPopoverActive && 'bg-surface-hover',
          )}
        >
          <div className="flex w-full items-center justify-center gap-2">
            <Settings2 className="size-5" aria-hidden="true" />
          </div>
        </Ariakit.MenuButton>
      }
      id="tools-dropdown-button"
      description={localize('com_ui_tools')}
      disabled={isDisabled}
    />
  );

  return (
    <DropdownPopup
      itemClassName="flex w-full cursor-pointer rounded-lg items-center justify-between hover:bg-surface-hover gap-5"
      menuId="tools-dropdown-menu"
      isOpen={isPopoverActive}
      setIsOpen={setIsPopoverActive}
      modal={true}
      unmountOnHide={true}
      trigger={menuTrigger}
      items={dropdownItems}
      iconClassName="mr-0"
    />
  );
};

export default React.memo(ToolsDropdown);
