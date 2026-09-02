import { Permissions, PermissionTypes } from 'librechat-data-provider';
import { drAutoStartAtom } from '~/store/deepResearch';
import { useGetStartupConfig } from '~/data-provider';
import ToggleSwitch from '../ToggleSwitch';
import { useHasAccess } from '~/hooks';

/**
 * «Запускать исследование сразу» (r30, owner 02.09) — the opt-in that replaced the plan
 * card's 30-second autostart. Shown only to someone who can start a research at all (web
 * search AND deep research: the composer badge's own gate) and only while the plan gate is
 * on — with no plan card there is nothing for the switch to skip.
 */
export default function DeepResearchAutoStart() {
  const { data: startupConfig } = useGetStartupConfig();
  const canUseWebSearch = useHasAccess({
    permissionType: PermissionTypes.WEB_SEARCH,
    permission: Permissions.USE,
  });
  const canUseDeepResearch = useHasAccess({
    permissionType: PermissionTypes.DEEP_RESEARCH,
    permission: Permissions.USE,
  });
  const planGate = startupConfig?.deepResearch?.planGate === true;
  return (
    <ToggleSwitch
      stateAtom={drAutoStartAtom}
      localizationKey="com_nav_dr_auto_start"
      descriptionKey="com_nav_dr_auto_start_desc"
      switchId="drAutoStart"
      showSwitch={planGate && canUseWebSearch && canUseDeepResearch}
    />
  );
}
