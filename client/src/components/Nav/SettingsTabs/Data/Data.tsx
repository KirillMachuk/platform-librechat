import React, { useState, useRef } from 'react';
import { SettingGroup, useOnClickOutside } from '@librechat/client';
import { Permissions, PermissionTypes } from 'librechat-data-provider';
import ImportConversations from './ImportConversations';
import { AgentApiKeys } from './AgentApiKeys';
import { DeleteCache } from './DeleteCache';
import { RevokeKeys } from './RevokeKeys';
import { ClearChats } from './ClearChats';
import SharedLinks from './SharedLinks';
import { useHasAccess } from '~/hooks';

function Data() {
  const dataTabRef = useRef(null);
  const [confirmClearConvos, setConfirmClearConvos] = useState(false);
  useOnClickOutside(dataTabRef, () => confirmClearConvos && setConfirmClearConvos(false), []);
  const hasAccessToApiKeys = useHasAccess({
    permissionType: PermissionTypes.REMOTE_AGENTS,
    permission: Permissions.USE,
  });

  return (
    <div className="flex flex-col gap-4 p-1 text-sm text-text-primary">
      <SettingGroup>
        <ImportConversations />
        <SharedLinks />
        {hasAccessToApiKeys && <AgentApiKeys />}
      </SettingGroup>
      {/* The irreversible ones sit in a card of their own — no key exists for a
          "danger zone" heading, so the separation carries the meaning. */}
      <SettingGroup>
        <RevokeKeys />
        <DeleteCache />
        <ClearChats />
      </SettingGroup>
    </div>
  );
}

export default React.memo(Data);
