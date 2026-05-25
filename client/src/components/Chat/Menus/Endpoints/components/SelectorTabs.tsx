import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

export type SelectorTab = 'agents' | 'llm';

interface SelectorTabsProps {
  activeTab: SelectorTab;
  onTabChange: (tab: SelectorTab) => void;
}

export function SelectorTabs({ activeTab, onTabChange }: SelectorTabsProps) {
  const localize = useLocalize();

  const buttonClass = (isActive: boolean) =>
    cn(
      'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary',
      isActive
        ? 'bg-surface-active text-text-primary'
        : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary',
    );

  return (
    <div
      role="tablist"
      aria-label={localize('com_ui_select_model')}
      className="flex w-full gap-1 border-b border-border-light px-2 pb-1 pt-1"
    >
      <button
        role="tab"
        type="button"
        aria-selected={activeTab === 'agents'}
        tabIndex={activeTab === 'agents' ? 0 : -1}
        onClick={() => onTabChange('agents')}
        className={buttonClass(activeTab === 'agents')}
      >
        {localize('com_ui_tab_agents')}
      </button>
      <button
        role="tab"
        type="button"
        aria-selected={activeTab === 'llm'}
        tabIndex={activeTab === 'llm' ? 0 : -1}
        onClick={() => onTabChange('llm')}
        className={buttonClass(activeTab === 'llm')}
      >
        {localize('com_ui_tab_llm_models')}
      </button>
    </div>
  );
}
