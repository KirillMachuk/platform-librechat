import React from 'react';
import { useRecoilState, useRecoilValue } from 'recoil';
import { Slider, InputNumber, SettingRow } from '@librechat/client';
import { cn, defaultTextProps, optionText } from '~/utils';
import { useLocalize } from '~/hooks';
import store from '~/store';

export default function DecibelSelector() {
  const localize = useLocalize();
  const speechToText = useRecoilValue(store.speechToText);
  const [decibelValue, setDecibelValue] = useRecoilState(store.decibelValue);

  return (
    <SettingRow
      id="decibel-selector"
      title={localize('com_nav_db_sensitivity')}
      description={`(${localize('com_endpoint_default_with_num', { 0: '-45' })})`}
      stackControlOnMobile
      control={({ labelId }) => (
        <div className="flex items-center gap-2">
          <Slider
            value={[decibelValue ?? -45]}
            onValueChange={(value) => setDecibelValue(value[0])}
            onDoubleClick={() => setDecibelValue(-45)}
            min={-100}
            max={-30}
            step={1}
            className="flex h-4 w-24"
            disabled={!speechToText}
            aria-labelledby={labelId}
          />
          <InputNumber
            value={decibelValue}
            disabled={!speechToText}
            onChange={(value) => setDecibelValue(value ? value[0] : 0)}
            min={-100}
            max={-30}
            aria-labelledby={labelId}
            className={cn(
              defaultTextProps,
              cn(
                optionText,
                'reset-rc-number-input reset-rc-number-input-text-right h-auto w-12 border-0 group-hover/temp:border-gray-200',
              ),
            )}
          />
        </div>
      )}
    />
  );
}
