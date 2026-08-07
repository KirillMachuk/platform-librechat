import React from 'react';
import { useRecoilState } from 'recoil';
import { Dropdown, SettingRow } from '@librechat/client';
import { useLocalize } from '~/hooks';
import store from '~/store';

interface EngineSTTDropdownProps {
  external: boolean;
}

const EngineSTTDropdown: React.FC<EngineSTTDropdownProps> = ({ external }) => {
  const localize = useLocalize();
  const [engineSTT, setEngineSTT] = useRecoilState<string>(store.engineSTT);

  const endpointOptions = external
    ? [
        { value: 'browser', label: localize('com_nav_browser') },
        { value: 'external', label: localize('com_nav_external') },
      ]
    : [{ value: 'browser', label: localize('com_nav_browser') }];

  const handleSelect = (value: string) => {
    setEngineSTT(value);
  };

  return (
    <SettingRow
      id="engine-stt-dropdown"
      title={localize('com_nav_engine')}
      stackControlOnMobile
      control={({ labelId }) => (
        <Dropdown
          value={engineSTT}
          onChange={handleSelect}
          options={endpointOptions}
          sizeClasses="w-[180px]"
          testId="EngineSTTDropdown"
          aria-labelledby={labelId}
        />
      )}
    />
  );
};

export default EngineSTTDropdown;
