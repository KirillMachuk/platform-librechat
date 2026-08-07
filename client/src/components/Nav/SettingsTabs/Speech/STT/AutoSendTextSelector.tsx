import React, { useState, useEffect } from 'react';
import { useRecoilState, useRecoilValue } from 'recoil';
import { Slider, InputNumber, Switch, SettingRow } from '@librechat/client';
import { cn, defaultTextProps, optionText } from '~/utils/';
import { useLocalize } from '~/hooks';
import store from '~/store';

export default function AutoSendTextSelector() {
  const localize = useLocalize();

  const speechToText = useRecoilValue(store.speechToText);
  const [autoSendText, setAutoSendText] = useRecoilState(store.autoSendText);

  // Local state for enabled/disabled toggle
  const [isEnabled, setIsEnabled] = useState(autoSendText !== -1);
  const [delayValue, setDelayValue] = useState(autoSendText === -1 ? 3 : autoSendText);

  // Sync local state when autoSendText changes externally
  useEffect(() => {
    setIsEnabled(autoSendText !== -1);
    if (autoSendText !== -1) {
      setDelayValue(autoSendText);
    }
  }, [autoSendText]);

  const handleToggle = (enabled: boolean) => {
    setIsEnabled(enabled);
    if (enabled) {
      setAutoSendText(delayValue);
    } else {
      setAutoSendText(-1);
    }
  };

  const handleSliderChange = (value: number[]) => {
    const newValue = value[0];
    setDelayValue(newValue);
    if (isEnabled) {
      setAutoSendText(newValue);
    }
  };

  const handleInputChange = (value: string | number | null) => {
    const parsed = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
    const newValue = Number.isNaN(parsed) ? 3 : parsed;
    setDelayValue(newValue);
    if (isEnabled) {
      setAutoSendText(newValue);
    }
  };

  return (
    <>
      <SettingRow
        id="auto-send-text"
        title={localize('com_nav_auto_send_text')}
        description={localize('com_nav_auto_send_text_desc')}
        control={({ labelId, descriptionId }) => (
          <Switch
            size="row"
            id="autoSendTextToggle"
            checked={isEnabled}
            onCheckedChange={handleToggle}
            data-testid="autoSendTextToggle"
            aria-labelledby={labelId}
            aria-describedby={descriptionId}
            disabled={!speechToText}
          />
        )}
      />
      {isEnabled && (
        <SettingRow
          id="auto-send-delay"
          title={localize('com_nav_setting_delay')}
          stackControlOnMobile
          control={({ labelId }) => (
            <div className="flex items-center gap-2">
              <Slider
                value={[delayValue]}
                onValueChange={handleSliderChange}
                onDoubleClick={() => {
                  setDelayValue(3);
                  if (isEnabled) {
                    setAutoSendText(3);
                  }
                }}
                min={0}
                max={60}
                step={1}
                className="flex h-4 w-24"
                disabled={!speechToText || !isEnabled}
                aria-labelledby={labelId}
              />
              <InputNumber
                value={`${delayValue} s`}
                disabled={!speechToText || !isEnabled}
                onChange={handleInputChange}
                min={0}
                max={60}
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
      )}
    </>
  );
}
