import { useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

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
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  /**
   * Roving tabindex takes the unselected tab out of the tab order, so arrow keys
   * are the only way to reach it — without them the tab that happens to be
   * selected is the only one a keyboard can ever use. The surrounding Ariakit
   * combobox cannot supply them: it ignores horizontal keys while focus is in a
   * text field, which is where its virtual focus keeps the caret.
   */
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    switch (event.key) {
      case 'ArrowRight':
        next = (index + 1) % TABS.length;
        break;
      case 'ArrowLeft':
        next = (index - 1 + TABS.length) % TABS.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = TABS.length - 1;
        break;
      default:
        // Everything else — Escape, Tab, typing — belongs to the menu around us.
        return;
    }
    event.preventDefault();
    onTabChange(TABS[next].id);
    // Synchronously: switching tabs remounts the list, and a deferred focus call
    // would land on a detached node and drop focus to <body>, closing the menu.
    tabRefs.current[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      aria-label={localize('com_ui_select_model')}
      /* Канон §1.4 и прототип: сегмент, а не полоса с линией снизу — трек `panel`
         с волосяной рамкой и радиусом 12, вложенный радиус 12−3=9. Выбранная
         вкладка выражается тинтом и цветом (`acc-soft` + `acc`): серым по серому
         выбор читался как 1,09 контраста, то есть никак. */
      className="mx-2 my-1.5 flex gap-[3px] rounded-xl border border-border-light bg-surface-primary-alt p-[3px]"
    >
      {TABS.map((tab, index) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            role="tab"
            type="button"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onTabChange(tab.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              'h-11 flex-1 rounded-[9px] px-3 text-[15px] font-medium transition-colors duration-90 md:h-[30px] md:text-[13px]',
              // Not ring-primary: it resolves to the same grey as surface-active in
              // the dark theme, so the ring on the selected tab was invisible (1:1).
              'focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text-primary',
              isActive
                ? 'bg-ring-primary-soft text-text-accent'
                : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary',
            )}
          >
            {localize(tab.label)}
          </button>
        );
      })}
    </div>
  );
}
