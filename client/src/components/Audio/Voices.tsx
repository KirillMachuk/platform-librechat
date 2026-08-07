import React from 'react';
import { useRecoilState } from 'recoil';
import { Dropdown, SettingRow } from '@librechat/client';
import type { Option } from '~/common';
import { useLocalize, useTTSBrowser, useTTSExternal } from '~/hooks';
import { logger } from '~/utils';
import store from '~/store';

export function BrowserVoiceDropdown() {
  const localize = useLocalize();
  const { voices = [] } = useTTSBrowser();
  const [voice, setVoice] = useRecoilState(store.voice);

  const handleVoiceChange = (newValue?: string | Option) => {
    logger.log('Browser Voice changed:', newValue);
    const newVoice = typeof newValue === 'string' ? newValue : newValue?.value;
    if (newVoice != null) {
      return setVoice(newVoice.toString());
    }
  };

  return (
    <SettingRow
      id="browser-voice-dropdown"
      title={localize('com_nav_voice_select')}
      stackControlOnMobile
      control={({ labelId }) => (
        <Dropdown
          key={`browser-voice-dropdown-${voices.length}`}
          value={voice ?? ''}
          options={voices}
          onChange={handleVoiceChange}
          sizeClasses="min-w-[200px] !max-w-[400px] [--anchor-max-width:400px]"
          testId="BrowserVoiceDropdown"
          aria-labelledby={labelId}
        />
      )}
    />
  );
}

export function ExternalVoiceDropdown() {
  const localize = useLocalize();
  const { voices = [] } = useTTSExternal();
  const [voice, setVoice] = useRecoilState(store.voice);

  const handleVoiceChange = (newValue?: string | Option) => {
    logger.log('External Voice changed:', newValue);
    const newVoice = typeof newValue === 'string' ? newValue : newValue?.value;
    if (newVoice != null) {
      return setVoice(newVoice.toString());
    }
  };

  return (
    <SettingRow
      id="external-voice-dropdown"
      title={localize('com_nav_voice_select')}
      stackControlOnMobile
      control={({ labelId }) => (
        <Dropdown
          key={`external-voice-dropdown-${voices.length}`}
          value={voice ?? ''}
          options={voices}
          onChange={handleVoiceChange}
          sizeClasses="min-w-[200px] !max-w-[400px] [--anchor-max-width:400px]"
          testId="ExternalVoiceDropdown"
          aria-labelledby={labelId}
        />
      )}
    />
  );
}
