import React from 'react';
import { useRecoilState, useRecoilValue } from 'recoil';
import { Slider, InputNumber, SettingRow } from '@librechat/client';
import { cn, defaultTextProps, optionText } from '~/utils';
import { useLocalize } from '~/hooks';
import store from '~/store';

export default function PlaybackRate() {
  const localize = useLocalize();
  const textToSpeech = useRecoilValue(store.textToSpeech);
  const [playbackRate, setPlaybackRate] = useRecoilState(store.playbackRate);

  return (
    <SettingRow
      id="playback-rate"
      title={localize('com_nav_playback_rate')}
      description={`(${localize('com_endpoint_default_with_num', { 0: '1' })})`}
      stackControlOnMobile
      control={({ labelId }) => (
        <div className="flex items-center gap-2">
          <Slider
            value={[playbackRate ?? 1]}
            onValueChange={(value) => setPlaybackRate(value[0])}
            onDoubleClick={() => setPlaybackRate(null)}
            min={0.1}
            max={2}
            step={0.1}
            className="flex h-4 w-24"
            disabled={!textToSpeech}
            aria-labelledby={labelId}
          />
          <InputNumber
            value={playbackRate ?? 1}
            disabled={!textToSpeech}
            onChange={(value) => setPlaybackRate(value ? value[0] : 0)}
            min={0.1}
            max={2}
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
