import { startTransition } from 'react';
import { useSetRecoilState } from 'recoil';
import { TooltipAnchor, Button, Sidebar } from '@librechat/client';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import store from '~/store';

export const CLOSE_SIDEBAR_ID = 'close-sidebar-button';
export const OPEN_SIDEBAR_ID = 'open-sidebar-button';

export default function OpenSidebar({ className }: { className?: string }) {
  const localize = useLocalize();
  const setSidebarExpanded = useSetRecoilState(store.sidebarExpanded);

  const handleClick = () => {
    startTransition(() => {
      setSidebarExpanded(true);
    });
    setTimeout(() => {
      document.getElementById(CLOSE_SIDEBAR_ID)?.focus();
    }, 250);
  };

  return (
    <TooltipAnchor
      description={localize('com_nav_open_sidebar')}
      render={
        <Button
          id={OPEN_SIDEBAR_ID}
          size="icon"
          variant="outline"
          data-testid="open-sidebar-button"
          aria-label={localize('com_nav_open_sidebar')}
          aria-expanded={false}
          aria-controls="chat-history-nav"
          className={cn(
            /* Канон §7: кнопка-иконка мобильной шапки — САМА 44×44, а не 40 с
               натянутой до 44 зоной нажатия. Размер безусловный: эта кнопка
               рендерится только на телефоне — все пять мест вызова стоят под
               `isSmallScreen` (Chat/Header.tsx, Agents/Marketplace.tsx,
               Prompts/forms/PromptForm.tsx ×2, Prompts/forms/CreatePromptForm.tsx,
               Skills/layouts/SkillsView.tsx).
               `h-11 w-11`, а НЕ `size-11`: tailwind-merge 1.14 группы `size-*` не
               знает, и `size-11` не вытеснил бы `size-10` из варианта `icon`
               (Button.tsx) — в разметке остались бы оба класса. */
            'tap-target h-11 w-11 rounded-xl bg-presentation duration-0 hover:bg-surface-active-alt',
            className,
          )}
          onClick={handleClick}
        >
          <Sidebar className="icon-md" aria-hidden="true" />
        </Button>
      }
    />
  );
}
