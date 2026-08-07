import React from 'react';
import { SettingGroup } from '@librechat/client';
import DisplayUsernameMessages from './DisplayUsernameMessages';
import EnableTwoFactorItem from './TwoFactorAuthentication';
import { useGetStartupConfig } from '~/data-provider';
import BackupCodesItem from './BackupCodesItem';
import DeleteAccount from './DeleteAccount';
import { useAuthContext } from '~/hooks';
import Avatar from './Avatar';

function Account() {
  const { user } = useAuthContext();
  const { data: startupConfig } = useGetStartupConfig();

  return (
    <div className="p-1 text-sm text-text-primary">
      <SettingGroup>
        <DisplayUsernameMessages />
        <Avatar />
        {user?.provider === 'local' && (
          <>
            <EnableTwoFactorItem />
            {user?.twoFactorEnabled && <BackupCodesItem />}
          </>
        )}
        {startupConfig?.allowAccountDeletion !== false && <DeleteAccount />}
      </SettingGroup>
    </div>
  );
}

export default React.memo(Account);
