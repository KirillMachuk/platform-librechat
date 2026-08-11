import React, { memo } from 'react';
import { CheckboxButton } from '@librechat/client';
import { Permissions, PermissionTypes } from 'librechat-data-provider';
import { useLocalize, useHasAccess } from '~/hooks';
import { useBadgeRowContext } from '~/Providers';
import { Globe } from '~/components/icons';

function WebSearch() {
  const localize = useLocalize();
  const canUseWebSearch = useHasAccess({
    permissionType: PermissionTypes.WEB_SEARCH,
    permission: Permissions.USE,
  });
  const context = useBadgeRowContext();
  if (!canUseWebSearch) {
    return null;
  }
  if (!context) {
    return null;
  }
  const { webSearch: webSearchData, searchApiKeyForm } = context;
  const { toggleState: webSearch, debouncedChange, isPinned, authData } = webSearchData;
  const { badgeTriggerRef } = searchApiKeyForm;

  return (
    (isPinned || (webSearch && authData?.authenticated)) && (
      <CheckboxButton
        ref={badgeTriggerRef}
        className="max-w-fit"
        checked={webSearch}
        setValue={debouncedChange}
        /* Chip wears the short name (owner 11.08-3, room in the row);
           the tools dropdown keeps the full one. */
        label={localize('com_ui_chip_web_search')}
        icon={<Globe className="icon-sm" aria-hidden="true" />}
      />
    )
  );
}

export default memo(WebSearch);
