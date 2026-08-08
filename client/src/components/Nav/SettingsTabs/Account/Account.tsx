import React from 'react';
import { SETTINGS_TAB_BODY } from '@librechat/client';
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
    <div className={SETTINGS_TAB_BODY}>
      <DisplayUsernameMessages />
      <Avatar />
      {user?.provider === 'local' && (
        <>
          <EnableTwoFactorItem />
          {user?.twoFactorEnabled && <BackupCodesItem />}
        </>
      )}
      {startupConfig?.allowAccountDeletion !== false && <DeleteAccount />}
    </div>
  );
}

export default React.memo(Account);
