import React, { memo } from 'react';
import { CheckboxButton } from '@librechat/client';
import { Permissions, PermissionTypes, defaultAgentCapabilities } from 'librechat-data-provider';
import { useLocalize, useHasAccess, useAgentCapabilities } from '~/hooks';
import { useBadgeRowContext } from '~/Providers';
import { Zap } from '~/components/icons';

function Skills() {
  const localize = useLocalize();
  const context = useBadgeRowContext();
  const { toggleState: skillsActive, debouncedChange, isPinned } = context?.skills ?? {};

  const canUseSkills = useHasAccess({
    permissionType: PermissionTypes.SKILLS,
    permission: Permissions.USE,
  });

  const { skillsEnabled } = useAgentCapabilities(
    context?.agentsConfig?.capabilities ?? defaultAgentCapabilities,
  );

  if (!canUseSkills || !skillsEnabled) {
    return null;
  }

  return (
    (skillsActive || isPinned) && (
      <CheckboxButton
        className="max-w-fit"
        checked={skillsActive}
        setValue={debouncedChange}
        label={localize('com_ui_skills')}
        icon={<Zap className="icon-sm" aria-hidden="true" />}
      />
    )
  );
}

export default memo(Skills);
