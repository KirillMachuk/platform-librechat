import React from 'react';
import { SettingRow, SettingGroup } from '@librechat/client';
import { getRefillEligibilityDate } from 'librechat-data-provider';
import type { RefillIntervalUnit, TBalanceResponse } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { formatTimestamp } from '~/utils';
import { useLocalize } from '~/hooks';

function ensureExhaustive(value: never): void {
  void value;
}

interface AutoRefillSettingsProps {
  lastRefill: NonNullable<TBalanceResponse['lastRefill']>;
  refillAmount: number;
  refillIntervalUnit: RefillIntervalUnit;
  refillIntervalValue: number;
}

const AutoRefillSettings: React.FC<AutoRefillSettingsProps> = ({
  lastRefill,
  refillAmount,
  refillIntervalUnit,
  refillIntervalValue,
}) => {
  const localize = useLocalize();

  const lastRefillDate = lastRefill ? new Date(lastRefill) : null;
  const refillEligibilityDate = lastRefillDate
    ? getRefillEligibilityDate(lastRefillDate, refillIntervalValue, refillIntervalUnit)
    : null;

  const getLocalizedIntervalUnit = (value: number, unit: RefillIntervalUnit): string => {
    let key: TranslationKeys;
    switch (unit) {
      case 'seconds':
        key = value === 1 ? 'com_nav_balance_second' : 'com_nav_balance_seconds';
        break;
      case 'minutes':
        key = value === 1 ? 'com_nav_balance_minute' : 'com_nav_balance_minutes';
        break;
      case 'hours':
        key = value === 1 ? 'com_nav_balance_hour' : 'com_nav_balance_hours';
        break;
      case 'days':
        key = value === 1 ? 'com_nav_balance_day' : 'com_nav_balance_days';
        break;
      case 'weeks':
        key = value === 1 ? 'com_nav_balance_week' : 'com_nav_balance_weeks';
        break;
      case 'months':
        key = value === 1 ? 'com_nav_balance_month' : 'com_nav_balance_months';
        break;
      default: {
        ensureExhaustive(unit);
        key = 'com_nav_balance_seconds';
      }
    }
    return localize(key);
  };

  return (
    <SettingGroup label={localize('com_nav_balance_auto_refill_settings')}>
      <SettingRow
        id="balance-last-refill"
        title={localize('com_nav_balance_last_refill')}
        control={<span>{lastRefillDate ? formatTimestamp(lastRefillDate) : '-'}</span>}
      />
      <SettingRow
        id="balance-refill-amount"
        title={localize('com_nav_balance_refill_amount')}
        control={<span>{refillAmount !== undefined ? refillAmount : '-'}</span>}
      />
      <SettingRow
        id="balance-interval"
        title={localize('com_nav_balance_interval')}
        control={
          <span>
            {localize('com_nav_balance_every')} {refillIntervalValue}{' '}
            {getLocalizedIntervalUnit(refillIntervalValue, refillIntervalUnit)}
          </span>
        }
      />
      <SettingRow
        id="balance-next-refill"
        title={localize('com_nav_balance_next_refill')}
        description={localize('com_nav_balance_next_refill_info')}
        control={
          <span className="text-sm font-medium text-text-primary" role="note">
            {refillEligibilityDate ? formatTimestamp(refillEligibilityDate) : '-'}
          </span>
        }
      />
    </SettingGroup>
  );
};

export default AutoRefillSettings;
