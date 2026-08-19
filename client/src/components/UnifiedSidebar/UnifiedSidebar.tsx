import { useCallback, useEffect, memo, startTransition } from 'react';
import { useRecoilState } from 'recoil';
import { useForm } from 'react-hook-form';
import { useMediaQuery } from '@librechat/client';
import type { ReactNode } from 'react';
import type { ChatFormValues } from '~/common';
import { ChatContext, ChatFormProvider, ActivePanelProvider } from '~/Providers';
import useUnifiedSidebarLinks from '~/hooks/Nav/useUnifiedSidebarLinks';
import { useChatHelpers, useLocalize } from '~/hooks';
import ExpandedPanel from './ExpandedPanel';
import Sidebar from './Sidebar';
import { cn } from '~/utils';
import store from '~/store';

/* Canon §4 rev. 17.08-2: expanded sidebar 264 (was the book's 240; the owner
   widened it +10% — chat titles were unreadable in 240), collapsed rail 56.
   Keep in lockstep with --c-side-w (style.css) and DESIGN_SYSTEM.md §4 /
   Appendix A — this constant is the real source, the token is the canon copy. */
const COLLAPSED_WIDTH = 56;
const EXPANDED_WIDTH = 264;
const TRANSITION_MS = 300;
const EASING = 'cubic-bezier(0.2, 0, 0, 1)';

/**
 * Isolates useChatHelpers Recoil subscriptions from the sidebar layout.
 * Atom changes (e.g. during streaming) only re-render this component
 * and the active panel — not the sidebar shell.
 */
function SidebarChatProvider({ children }: { children: ReactNode }) {
  const chatHelpers = useChatHelpers(0);
  const sidebarFormMethods = useForm<ChatFormValues>({ defaultValues: { text: '' } });
  return (
    <ChatFormProvider {...sidebarFormMethods}>
      <ChatContext.Provider value={chatHelpers}>{children}</ChatContext.Provider>
    </ChatFormProvider>
  );
}

function UnifiedSidebar() {
  const localize = useLocalize();
  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  const [expanded, setExpanded] = useRecoilState(store.sidebarExpanded);

  const links = useUnifiedSidebarLinks();

  const handleCollapse = useCallback(() => {
    startTransition(() => {
      setExpanded(false);
    });
  }, [setExpanded]);

  const handleExpand = useCallback(() => {
    startTransition(() => {
      setExpanded(true);
    });
  }, [setExpanded]);

  useEffect(() => {
    if (!isSmallScreen || !expanded) {
      return;
    }
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCollapse();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isSmallScreen, expanded, handleCollapse]);

  if (isSmallScreen) {
    return (
      <>
        <div
          data-testid="sidebar-drawer"
          className={cn(
            /* overscroll-contain: the drawer is a gesture fence — a swipe that
               exhausts an inner scroller must DIE here, not chain into the
               chat behind the scrim (owner 19.08: «скроллится платформа, а не
               сайдбар», and the platform's momentum then locks the list out). */
            'fixed left-0 top-0 z-drawer flex h-full overscroll-contain bg-surface-primary-alt',
            expanded ? 'translate-x-0' : '-translate-x-full',
          )}
          style={{
            /** Канон §7: на телефоне меню — панель в 72% ширины экрана. */
            width: '72vw',
            transition: `transform ${TRANSITION_MS}ms ${EASING}`,
          }}
          inert={!expanded ? '' : undefined}
        >
          <SidebarChatProvider>
            <ActivePanelProvider>
              <ExpandedPanel links={links} expanded onCollapse={handleCollapse} />
            </ActivePanelProvider>
          </SidebarChatProvider>
        </div>
        <div
          className={cn(
            'fixed inset-0 z-scrim-drawer bg-scrim',
            expanded ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
          )}
          style={{ transition: `opacity ${TRANSITION_MS}ms ${EASING}` }}
          role="presentation"
        >
          <button
            /* touch-none: a swipe on the dimmed area must not scroll the chat
               behind it — the scrim swallows gestures, a tap still closes. */
            className="h-full w-full touch-none"
            onClick={handleCollapse}
            aria-label={localize('com_nav_close_sidebar')}
            tabIndex={expanded ? 0 : -1}
          />
        </div>
      </>
    );
  }

  return (
    <SidebarChatProvider>
      <ActivePanelProvider>
        <aside
          className="relative flex h-full flex-shrink-0 overflow-hidden"
          style={{
            width: expanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH,
            minWidth: expanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH,
            maxWidth: expanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH,
            transition: `width ${TRANSITION_MS}ms ${EASING}, min-width ${TRANSITION_MS}ms ${EASING}, max-width ${TRANSITION_MS}ms ${EASING}`,
          }}
          aria-label={localize('com_nav_control_panel')}
        >
          <Sidebar
            links={links}
            expanded={expanded}
            onCollapse={handleCollapse}
            onExpand={handleExpand}
          />
        </aside>
      </ActivePanelProvider>
    </SidebarChatProvider>
  );
}

export default memo(UnifiedSidebar);
