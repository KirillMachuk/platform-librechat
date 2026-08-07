import React from 'react';
import { Button, SettingRow } from '@librechat/client';
import { useLocalize } from '~/hooks';

interface DisableTwoFactorToggleProps {
  enabled: boolean;
  onChange: () => void;
  disabled?: boolean;
  buttonRef?: React.RefObject<HTMLButtonElement>;
}

export const DisableTwoFactorToggle: React.FC<DisableTwoFactorToggleProps> = ({
  enabled,
  onChange,
  disabled,
  buttonRef,
}) => {
  const localize = useLocalize();

  return (
    <SettingRow
      id="two-factor-authentication"
      title={localize('com_nav_2fa')}
      stackControlOnMobile
      control={
        <Button
          ref={buttonRef}
          variant={enabled ? 'destructive' : 'outline'}
          onClick={onChange}
          disabled={disabled}
          aria-haspopup="dialog"
          aria-controls="two-factor-authentication-dialog"
        >
          {enabled ? localize('com_ui_2fa_disable') : localize('com_ui_2fa_enable')}
        </Button>
      }
    />
  );
};
