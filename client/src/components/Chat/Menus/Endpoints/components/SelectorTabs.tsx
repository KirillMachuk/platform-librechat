import { useMemo } from 'react';
import { Segmented } from '~/components/ui/Segmented';
import { useLocalize } from '~/hooks';

export type SelectorTab = 'agents' | 'llm';

interface SelectorTabsProps {
  activeTab: SelectorTab;
  onTabChange: (tab: SelectorTab) => void;
}

const TABS: { id: SelectorTab; label: 'com_ui_tab_agents' | 'com_ui_tab_llm_models' }[] = [
  { id: 'agents', label: 'com_ui_tab_agents' },
  { id: 'llm', label: 'com_ui_tab_llm_models' },
];

export function SelectorTabs({ activeTab, onTabChange }: SelectorTabsProps) {
  const localize = useLocalize();
  const items = useMemo(
    () => TABS.map((tab) => ({ id: tab.id, label: localize(tab.label) })),
    [localize],
  );

  return (
    <Segmented
      items={items}
      value={activeTab}
      onChange={onTabChange}
      label={localize('com_ui_select_model')}
      className="mx-1.5 my-1.5"
    />
  );
}
