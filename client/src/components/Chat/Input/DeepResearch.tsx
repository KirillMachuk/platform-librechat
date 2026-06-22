import React, { memo } from 'react';
import { Telescope } from 'lucide-react';
import { CheckboxButton } from '@librechat/client';
import { Permissions, PermissionTypes, defaultAgentCapabilities } from 'librechat-data-provider';
import { useGetStartupConfig } from '~/data-provider';
import { useLocalize, useHasAccess, useAgentCapabilities } from '~/hooks';
import { useBadgeRowContext } from '~/Providers';

function DeepResearch() {
  const localize = useLocalize();
  const { data: startupConfig } = useGetStartupConfig();
  /** P1: Deep Research reuses the Web Search permission for RBAC; the per-tenant
   *  on/off is the `deepResearch` interface flag, AND the `deep_research` agent
   *  capability must be enabled (else the backend ignores the toggle). */
  const canUseDeepResearch = useHasAccess({
    permissionType: PermissionTypes.WEB_SEARCH,
    permission: Permissions.USE,
  });
  const context = useBadgeRowContext();
  const { deepResearchEnabled } = useAgentCapabilities(
    context?.agentsConfig?.capabilities ?? defaultAgentCapabilities,
  );
  if (
    !context ||
    !deepResearchEnabled ||
    !canUseDeepResearch ||
    startupConfig?.interface?.deepResearch === false
  ) {
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
