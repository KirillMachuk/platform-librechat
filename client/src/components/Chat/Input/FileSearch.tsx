import React, { memo } from 'react';
import { CheckboxButton } from '@librechat/client';
import { PermissionTypes, Permissions } from 'librechat-data-provider';
import { FileSearchIcon } from '~/components/icons';
import { useLocalize, useHasAccess } from '~/hooks';
import { useBadgeRowContext } from '~/Providers';

function FileSearch() {
  const localize = useLocalize();
  const context = useBadgeRowContext();
  const { toggleState: fileSearchEnabled, debouncedChange, isPinned } = context?.fileSearch ?? {};

  const canUseFileSearch = useHasAccess({
    permissionType: PermissionTypes.FILE_SEARCH,
    permission: Permissions.USE,
  });

  if (!canUseFileSearch) {
    return null;
  }

  return (
    <>
      {(fileSearchEnabled || isPinned) && (
        <CheckboxButton
          className="max-w-fit"
          checked={fileSearchEnabled}
          setValue={debouncedChange}
          label={localize('com_ui_chip_file_search')}
          icon={<FileSearchIcon className="icon-sm" aria-hidden="true" />}
        />
      )}
    </>
  );
}

export default memo(FileSearch);
