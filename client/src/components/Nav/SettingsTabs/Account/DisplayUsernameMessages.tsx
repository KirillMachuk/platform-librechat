import ToggleSwitch from '../ToggleSwitch';
import store from '~/store';

export default function DisplayUsernameMessages() {
  return (
    <ToggleSwitch
      stateAtom={store.UsernameDisplay}
      localizationKey={'com_nav_user_name_display' as const}
      descriptionKey={'com_nav_info_user_name_display' as const}
      switchId="UsernameDisplay"
    />
  );
}
