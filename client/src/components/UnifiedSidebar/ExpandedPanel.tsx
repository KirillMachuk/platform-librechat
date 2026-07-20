import { memo, useCallback, useEffect, useRef, useState, lazy, Suspense } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { useRecoilValue } from 'recoil';
import { SquarePen } from 'lucide-react';
import { QueryKeys } from 'librechat-data-provider';
import { Skeleton, Sidebar as SidebarIcon, Button, TooltipAnchor } from '@librechat/client';
import type { NavLink } from '~/common';
import { CLOSE_SIDEBAR_ID } from '~/components/Chat/Menus/OpenSidebar';
import ConversationsSection from '~/components/UnifiedSidebar/ConversationsSection';
import { SearchChatsRow, SearchChatsDialog } from '~/components/Nav/SearchChats';
import PanelDialog from '~/components/UnifiedSidebar/PanelDialog';
import { useLocalize, useNewConvo } from '~/hooks';
import { clearMessagesCache, cn } from '~/utils';
import store from '~/store';

const AccountSettings = lazy(() => import('~/components/Nav/AccountSettings'));

const NewChatRow = memo(function NewChatRow() {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const { newConversation } = useNewConvo();
  const conversation = useRecoilValue(store.conversationByIndex(0));

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (e.button === 0 && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        clearMessagesCache(queryClient, conversation?.conversationId);
        queryClient.invalidateQueries([QueryKeys.messages]);
        newConversation();
      }
    },
    [queryClient, conversation?.conversationId, newConversation],
  );

  return (
    <a
      href="/c/new"
      data-testid="new-chat-button"
      aria-label={localize('com_ui_new_chat')}
      className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-sm text-text-primary transition-colors hover:bg-surface-hover"
      onClick={handleClick}
    >
      <SquarePen className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
      <span className="truncate">{localize('com_ui_new_chat')}</span>
    </a>
  );
});

const NewChatIconButton = memo(function NewChatIconButton() {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const { newConversation } = useNewConvo();
  const conversation = useRecoilValue(store.conversationByIndex(0));

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (e.button === 0 && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        clearMessagesCache(queryClient, conversation?.conversationId);
        queryClient.invalidateQueries([QueryKeys.messages]);
        newConversation();
      }
    },
    [queryClient, conversation?.conversationId, newConversation],
  );

  return (
    <TooltipAnchor
      side="right"
      description={localize('com_ui_new_chat')}
      render={
        <a
          href="/c/new"
          aria-label={localize('com_ui_new_chat')}
          className="flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-surface-hover"
          onClick={handleClick}
        >
          <SquarePen className="h-5 w-5 text-text-primary" aria-hidden="true" />
        </a>
      }
    />
  );
});

const MenuRow = memo(function MenuRow({
  link,
  onSelect,
}: {
  link: NavLink;
  onSelect: (link: NavLink) => void;
}) {
  const localize = useLocalize();
  const Icon = link.icon;

  return (
    <Button
      variant="ghost"
      aria-label={localize(link.title)}
      className="flex h-9 w-full items-center justify-start gap-2 rounded-lg px-2 text-sm font-normal text-text-primary hover:bg-surface-hover"
      onClick={() => onSelect(link)}
    >
      {Icon ? <Icon className="h-5 w-5 flex-shrink-0" aria-hidden="true" /> : null}
      <span className="truncate">{localize(link.title)}</span>
    </Button>
  );
});

function ExpandedPanel({
  links,
  expanded = true,
  onCollapse,
  onExpand,
}: {
  links: NavLink[];
  expanded?: boolean;
  onCollapse?: () => void;
  onExpand?: () => void;
}) {
  const localize = useLocalize();
  const [activeLink, setActiveLink] = useState<NavLink | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  /**
   * Panel content (Agents "Start chat", Skills/Prompts items) can navigate the app
   * under the open dialog; close it on any navigation so the user lands on the
   * destination instead of behind the modal. Keyed on `location.key` because
   * "start chat" from a fresh chat re-navigates to the same `/c/new` pathname.
   * In-panel interactions only touch local state, so this never fires mid-browsing.
   */
  const location = useLocation();
  const prevLocationKeyRef = useRef(location.key);
  useEffect(() => {
    if (prevLocationKeyRef.current === location.key) {
      return;
    }
    prevLocationKeyRef.current = location.key;
    setDialogOpen(false);
    setActiveLink(null);
  }, [location.key]);

  const toggleLabel = expanded ? 'com_nav_close_sidebar' : 'com_nav_open_sidebar';
  const toggleClick = expanded ? onCollapse : onExpand;

  const handleSelect = useCallback((link: NavLink) => {
    if (link.onClick) {
      link.onClick(undefined as unknown as React.MouseEvent<HTMLButtonElement>);
      return;
    }
    if (!link.Component) {
      return;
    }
    setActiveLink(link);
    setDialogOpen(true);
  }, []);

  const handleDialogChange = useCallback((next: boolean) => {
    setDialogOpen(next);
    if (!next) {
      setActiveLink(null);
    }
  }, []);

  const menuLinks = links.filter((link) => link.id !== 'conversations');

  const collapsed = (
    <div className="flex h-full w-full flex-shrink-0 flex-col items-center gap-2 border-r border-border-light bg-surface-primary-alt px-2 py-2">
      <TooltipAnchor
        side="right"
        description={localize(toggleLabel)}
        render={
          <Button
            data-testid="open-sidebar-button"
            size="icon"
            variant="ghost"
            aria-label={localize(toggleLabel)}
            aria-expanded={false}
            className="h-9 w-9 rounded-lg"
            onClick={toggleClick}
          >
            <SidebarIcon aria-hidden="true" className="h-5 w-5 text-text-primary" />
          </Button>
        }
      />
      <NewChatIconButton />
      <SearchChatsRow variant="icon" />
    </div>
  );

  const fullPanel = (
    <div className="flex h-full w-full flex-shrink-0 flex-col border-r border-border-light bg-surface-primary-alt">
      <div className="flex items-center justify-between gap-2 px-2 py-2">
        <TooltipAnchor
          side="right"
          description={localize(toggleLabel)}
          render={
            <Button
              id={CLOSE_SIDEBAR_ID}
              data-testid="close-sidebar-button"
              size="icon"
              variant="ghost"
              aria-label={localize(toggleLabel)}
              aria-expanded={true}
              className="h-9 w-9 rounded-lg"
              onClick={toggleClick}
            >
              <SidebarIcon aria-hidden="true" className="h-5 w-5 text-text-primary" />
            </Button>
          }
        />
      </div>

      <div className="flex flex-col gap-0.5 px-2">
        <NewChatRow />
        <SearchChatsRow />
        {menuLinks.map((link) => (
          <MenuRow key={link.id} link={link} onSelect={handleSelect} />
        ))}
      </div>

      <div className={cn('mt-3 min-h-0 flex-1 overflow-hidden')}>
        <ConversationsSection />
      </div>

      <div className="border-t border-border-light px-2 py-2">
        <Suspense fallback={<Skeleton className="h-9 w-full rounded-lg" />}>
          <AccountSettings />
        </Suspense>
      </div>

      <PanelDialog link={activeLink} open={dialogOpen} onOpenChange={handleDialogChange} />
    </div>
  );

  return (
    <>
      {expanded ? fullPanel : collapsed}
      <SearchChatsDialog />
    </>
  );
}

export default memo(ExpandedPanel);
