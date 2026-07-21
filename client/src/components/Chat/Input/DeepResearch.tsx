import React, { memo } from 'react';
import { Telescope } from 'lucide-react';
import { CheckboxButton } from '@librechat/client';
import { Permissions, PermissionTypes, defaultAgentCapabilities } from 'librechat-data-provider';
import { useLocalize, useHasAccess, useAgentCapabilities } from '~/hooks';
import { useBadgeRowContext } from '~/Providers';

function DeepResearch() {
  const localize = useLocalize();
  /** Mirrors the server admission gate: research reaches the open internet, so it takes
   *  web search AND its own permission. Checking `interface.deepResearch` here as well
   *  would override whatever an admin later set on the role. The `deep_research` agent
   *  capability must also be on, else the backend ignores the toggle. */
  const canUseWebSearch = useHasAccess({
    permissionType: PermissionTypes.WEB_SEARCH,
    permission: Permissions.USE,
  });
  const canUseDeepResearch = useHasAccess({
    permissionType: PermissionTypes.DEEP_RESEARCH,
    permission: Permissions.USE,
  });
  const context = useBadgeRowContext();
  const { deepResearchEnabled } = useAgentCapabilities(
    context?.agentsConfig?.capabilities ?? defaultAgentCapabilities,
  );
  if (!context || !deepResearchEnabled || !canUseWebSearch || !canUseDeepResearch) {
    return null;
  }
  const { deepResearch: deepResearchData } = context;
  const { toggleState: deepResearch, debouncedChange, isPinned } = deepResearchData;

  return (
    (isPinned || deepResearch === true) && (
      <CheckboxButton
        className="max-w-fit"
        checked={deepResearch === true}
        setValue={debouncedChange}
        label={localize('com_ui_deep_research')}
        isCheckedClassName="border-blue-600/40 bg-blue-500/10 hover:bg-blue-700/10"
        icon={<Telescope className="icon-md" aria-hidden="true" />}
      />
    )
  );
}

export default memo(DeepResearch);
