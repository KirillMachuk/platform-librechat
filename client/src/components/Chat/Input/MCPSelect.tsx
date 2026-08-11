import React, { memo, useMemo } from 'react';
import * as Ariakit from '@ariakit/react';
import { PermissionTypes, Permissions } from 'librechat-data-provider';
import { TooltipAnchor, CHIP_BASE, CHIP_CHECKED } from '@librechat/client';
import MCPServerMenuItem from '~/components/MCP/MCPServerMenuItem';
import MCPConfigDialog from '~/components/MCP/MCPConfigDialog';
import StackedMCPIcons from '~/components/MCP/StackedMCPIcons';
import { useHasAccess, useLocalize } from '~/hooks';
import { ChevronDown } from '~/components/icons';
import { useBadgeRowContext } from '~/Providers';
import { cn } from '~/utils';

function MCPSelectContent() {
  const localize = useLocalize();
  const context = useBadgeRowContext();
  const { conversationId, storageContextKey, mcpServerManager: manager } = context ?? {};

  const menuStore = Ariakit.useMenuStore({ focusLoop: true });
  const isOpen = menuStore.useState('open');

  const selectedServers = useMemo(() => {
    if (!manager?.mcpValues || manager.mcpValues.length === 0) {
      return [];
    }
    const selectedSet = new Set(manager.mcpValues);
    return manager.selectableServers?.filter((s) => selectedSet.has(s.serverName));
  }, [manager?.selectableServers, manager?.mcpValues]);

  const displayText = useMemo(() => {
    const selectedCount = manager?.mcpValues?.length ?? 0;
    if (selectedCount === 0) {
      return null;
    }
    if (selectedCount === 1) {
      const server = manager?.selectableServers?.find(
        (s) => s.serverName === manager?.mcpValues?.[0],
      );
      return server?.config?.title || manager?.mcpValues?.[0];
    }
    return localize('com_ui_x_selected', { 0: selectedCount });
  }, [manager?.selectableServers, manager?.mcpValues, localize]);

  if (!manager) {
    return null;
  }

  const {
    isPinned,
    mcpValues,
    isInitializing,
    placeholderText,
    connectionStatus,
    selectableServers,
    getConfigDialogProps,
    toggleServerSelection,
    getServerStatusIconProps,
  } = manager;

  if (!isPinned && mcpValues?.length === 0) {
    return null;
  }

  const configDialogProps = getConfigDialogProps();

  return (
    <>
      <Ariakit.MenuProvider store={menuStore}>
        <TooltipAnchor
          description={placeholderText}
          disabled={isOpen}
          render={
            <Ariakit.MenuButton
              /* The MCP pill is a tool chip (§6.3) that happens to open a menu:
                 same base, same 34 height, and with servers selected it wears
                 the same neutral "on" fill as every other enabled chip — it
                 used to be a lone 36px white pill next to tinted ones. */
              className={cn(
                CHIP_BASE,
                'h-[34px] min-w-[34px] px-2.5 md:w-fit md:justify-start md:px-3',
                (mcpValues?.length ?? 0) > 0 && CHIP_CHECKED,
                isOpen && (mcpValues?.length ?? 0) === 0 && 'bg-surface-hover',
              )}
            />
          }
        >
          <StackedMCPIcons selectedServers={selectedServers} maxIcons={3} iconSize="sm" />
          <span className="hidden truncate text-text-primary md:block">
            {displayText || placeholderText}
          </span>
          <ChevronDown
            className={cn(
              'hidden h-3 w-3 text-text-secondary transition-transform md:block',
              isOpen && 'rotate-180',
            )}
          />
        </TooltipAnchor>

        <Ariakit.Menu
          portal={true}
          gutter={8}
          modal={true}
          unmountOnHide={true}
          aria-label={localize('com_ui_mcp_servers')}
          className={cn(
            'z-popover flex min-w-[260px] max-w-[320px] flex-col rounded-xl',
            /* card, not presentation — same 11.08 menu-surface fix as the
               selector: presentation is the page behind the card. */
            'border border-border-light bg-surface-primary p-1.5 shadow-lg',
            'origin-top opacity-0 transition-[opacity,transform] duration-200 ease-out',
            'data-[enter]:scale-100 data-[enter]:opacity-100',
            'scale-95 data-[leave]:scale-95 data-[leave]:opacity-0',
          )}
        >
          <div className="flex max-h-[320px] flex-col gap-1 overflow-y-auto">
            {selectableServers.map((server) => (
              <MCPServerMenuItem
                key={server.serverName}
                server={server}
                isSelected={mcpValues?.includes(server.serverName) ?? false}
                connectionStatus={connectionStatus}
                isInitializing={isInitializing}
                statusIconProps={getServerStatusIconProps(server.serverName)}
                onToggle={toggleServerSelection}
              />
            ))}
          </div>
        </Ariakit.Menu>
      </Ariakit.MenuProvider>
      {configDialogProps && (
        <MCPConfigDialog
          {...configDialogProps}
          conversationId={conversationId}
          storageContextKey={storageContextKey}
        />
      )}
    </>
  );
}

function MCPSelect() {
  const context = useBadgeRowContext();
  const { selectableServers } = context?.mcpServerManager ?? {};
  const canUseMcp = useHasAccess({
    permissionType: PermissionTypes.MCP_SERVERS,
    permission: Permissions.USE,
  });

  if (!canUseMcp || !selectableServers || selectableServers.length === 0) {
    return null;
  }

  return <MCPSelectContent />;
}

export default memo(MCPSelect);
