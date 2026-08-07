import React from 'react';
import { useRecoilState } from 'recoil';
import { Dropdown, SettingRow } from '@librechat/client';
import { useLocalize } from '~/hooks';
import store from '~/store';

interface EngineTTSDropdownProps {
  external: boolean;
}

const EngineTTSDropdown: React.FC<EngineTTSDropdownProps> = ({ external }) => {
  const localize = useLocalize();
  const [engineTTS, setEngineTTS] = useRecoilState<string>(store.engineTTS);

  const endpointOptions = external
    ? [
        { value: 'browser', label: localize('com_nav_browser') },
        { value: 'external', label: localize('com_nav_external') },
      ]
    : [{ value: 'browser', label: localize('com_nav_browser') }];

  const handleSelect = (value: string) => {
    setEngineTTS(value);
  };

  return (
    <SettingRow
      id="engine-tts-dropdown"
      title={localize('com_nav_engine')}
      stackControlOnMobile
      control={({ labelId }) => (
        <Dropdown
          value={engineTTS}
          onChange={handleSelect}
          options={endpointOptions}
          sizeClasses="w-[180px]"
          testId="EngineTTSDropdown"
          aria-labelledby={labelId}
        />
      )}
    />
  );
};

export default EngineTTSDropdown;
