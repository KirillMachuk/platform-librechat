import { WritableAtom, useAtom } from 'jotai';
import { RecoilState, useRecoilState } from 'recoil';
import { Switch, SettingRow } from '@librechat/client';
import { useLocalize } from '~/hooks';

type LocalizeFn = ReturnType<typeof useLocalize>;
type LocalizeKey = Parameters<LocalizeFn>[0];

interface ToggleSwitchProps {
  stateAtom: RecoilState<boolean> | WritableAtom<boolean, [boolean], void>;
  localizationKey: LocalizeKey;
  /**
   * The line under the title (canon §6.4). This used to be `hoverCardText`: an
   * "i" bubble that a touch screen can never open, holding the only explanation
   * of what the switch does. On screen it is a line of text, not a secret.
   */
  descriptionKey?: LocalizeKey;
  icon?: React.ReactNode;
  switchId: string;
  onCheckedChange?: (value: boolean) => void;
  showSwitch?: boolean;
  disabled?: boolean;
}

function isRecoilState<T>(atom: unknown): atom is RecoilState<T> {
  return atom != null && typeof atom === 'object' && 'key' in atom;
}

type RowProps = Omit<ToggleSwitchProps, 'stateAtom' | 'showSwitch'> & {
  checked: boolean;
  onChange: (value: boolean) => void;
};

const Row: React.FC<RowProps> = ({
  localizationKey,
  descriptionKey,
  icon,
  switchId,
  disabled = false,
  checked,
  onChange,
}) => {
  const localize = useLocalize();

  return (
    <SettingRow
      id={switchId}
      icon={icon}
      title={localize(localizationKey)}
      description={descriptionKey ? localize(descriptionKey) : undefined}
      control={({ labelId, descriptionId }) => (
        <Switch
          size="row"
          id={switchId}
          checked={checked}
          onCheckedChange={onChange}
          disabled={disabled}
          data-testid={switchId}
          aria-labelledby={labelId}
          aria-describedby={descriptionId}
        />
      )}
    />
  );
};

const RecoilToggle: React.FC<
  Omit<ToggleSwitchProps, 'stateAtom' | 'showSwitch'> & { stateAtom: RecoilState<boolean> }
> = ({ stateAtom, onCheckedChange, ...rest }) => {
  const [switchState, setSwitchState] = useRecoilState(stateAtom);

  return (
    <Row
      {...rest}
      checked={switchState}
      onChange={(value) => {
        setSwitchState(value);
        onCheckedChange?.(value);
      }}
    />
  );
};

const JotaiToggle: React.FC<
  Omit<ToggleSwitchProps, 'stateAtom' | 'showSwitch'> & {
    stateAtom: WritableAtom<boolean, [boolean], void>;
  }
> = ({ stateAtom, onCheckedChange, ...rest }) => {
  const [switchState, setSwitchState] = useAtom(stateAtom);

  return (
    <Row
      {...rest}
      checked={switchState}
      onChange={(value) => {
        setSwitchState(value);
        onCheckedChange?.(value);
      }}
    />
  );
};

const ToggleSwitch: React.FC<ToggleSwitchProps> = ({ showSwitch = true, ...props }) => {
  if (!showSwitch) {
    return null;
  }

  if (isRecoilState(props.stateAtom)) {
    return <RecoilToggle {...props} stateAtom={props.stateAtom as RecoilState<boolean>} />;
  }

  return (
    <JotaiToggle {...props} stateAtom={props.stateAtom as WritableAtom<boolean, [boolean], void>} />
  );
};

export default ToggleSwitch;
