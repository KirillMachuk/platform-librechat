import React from 'react';
import { SettingRow } from '@librechat/client';
import { useLocalize } from '~/hooks';

interface TokenCreditsItemProps {
  tokenCredits?: number;
}

const TokenCreditsItem: React.FC<TokenCreditsItemProps> = ({ tokenCredits }) => {
  const localize = useLocalize();

  return (
    <SettingRow
      id="token-credits"
      title={localize('com_nav_balance')}
      description={localize('com_nav_info_balance')}
      control={
        <span className="text-sm font-medium text-text-primary" role="note">
          {tokenCredits !== undefined ? tokenCredits.toFixed(2) : '0.00'}
        </span>
      }
    />
  );
};

export default TokenCreditsItem;
