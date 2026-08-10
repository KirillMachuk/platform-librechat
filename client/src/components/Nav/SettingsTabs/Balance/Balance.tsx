import React from 'react';
import { SettingGroup, SETTINGS_TAB_BODY } from '@librechat/client';
import { useGetStartupConfig, useGetUserBalance } from '~/data-provider';
import { useAuthContext, useLocalize } from '~/hooks';
import AutoRefillSettings from './AutoRefillSettings';
import TokenCreditsItem from './TokenCreditsItem';

function Balance() {
  const localize = useLocalize();
  const { isAuthenticated } = useAuthContext();
  const { data: startupConfig } = useGetStartupConfig();

  const balanceQuery = useGetUserBalance({
    enabled: !!isAuthenticated && !!startupConfig?.balance?.enabled,
  });
  const balanceData = balanceQuery.data;

  // Pull out all the fields we need, with safe defaults
  const {
    tokenCredits = 0,
    autoRefillEnabled = false,
    lastRefill,
    refillAmount,
    refillIntervalUnit,
    refillIntervalValue,
  } = balanceData ?? {};

  // Check that all auto-refill props are present
  const hasValidRefillSettings =
    lastRefill !== undefined &&
    refillAmount !== undefined &&
    refillIntervalUnit !== undefined &&
    refillIntervalValue !== undefined;

  const renderAutoRefill = () => {
    if (!autoRefillEnabled) {
      return (
        <div className="text-sm text-text-secondary">
          {localize('com_nav_balance_auto_refill_disabled')}
        </div>
      );
    }
    if (!hasValidRefillSettings) {
      return (
        <div className="text-sm text-text-destructive">
          {localize('com_nav_balance_auto_refill_error')}
        </div>
      );
    }
    return (
      <AutoRefillSettings
        lastRefill={lastRefill}
        refillAmount={refillAmount}
        refillIntervalUnit={refillIntervalUnit}
        refillIntervalValue={refillIntervalValue}
      />
    );
  };

  return (
    <div className={SETTINGS_TAB_BODY}>
      <SettingGroup>
        <TokenCreditsItem tokenCredits={tokenCredits} />
      </SettingGroup>
      {renderAutoRefill()}
    </div>
  );
}

export default React.memo(Balance);
