import { memo, useCallback, useState, lazy, Suspense } from 'react';
import { useRecoilValue } from 'recoil';
import { QueryKeys } from 'librechat-data-provider';
import { useQueryClient } from '@tanstack/react-query';
import { Skeleton, Button, TooltipAnchor } from '@librechat/client';
/* Phosphor's SidebarSimple (exported as PanelLeftOpen) — the book's panel
   glyph; the lucide `Sidebar` from @librechat/client predated the icon
   migration and was the «старая иконка» the owner flagged on 11.08. */
import { PanelLeftOpen as SidebarIcon } from '~/components/icons';
import type { NavLink } from '~/common';
import {
  sidebarRowActiveIconClassName,
  sidebarIconButtonClassName,
  sidebarRowActiveClassName,
  sidebarNewChatClassName,
  sidebarRowIconClassName,
  sidebarRowClassName,
} from './rows';
import ConversationsSection from '~/components/UnifiedSidebar/ConversationsSection';
import { SearchChatsRow, SearchChatsDialog } from '~/components/Nav/SearchChats';
import { CLOSE_SIDEBAR_ID } from '~/components/Chat/Menus/OpenSidebar';
import PanelDialog from '~/components/UnifiedSidebar/PanelDialog';
import { useGetStartupConfig } from '~/data-provider';
import { useLocalize, useNewConvo } from '~/hooks';
import { clearMessagesCache, cn } from '~/utils';
import { SquarePen } from '~/components/icons';
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
      className={sidebarNewChatClassName}
      onClick={handleClick}
    >
      <SquarePen className="icon-md flex-shrink-0" aria-hidden="true" />
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
          className={sidebarIconButtonClassName}
          onClick={handleClick}
        >
          <SquarePen className="icon-md" aria-hidden="true" />
        </a>
      }
    />
  );
});

const MenuRow = memo(function MenuRow({
  link,
  active,
  onSelect,
}: {
  link: NavLink;
  active: boolean;
  onSelect: (link: NavLink) => void;
}) {
  const localize = useLocalize();
  const Icon = link.icon;

  return (
    <Button
      variant="ghost"
      data-testid={`sidebar-link-${link.id}`}
      aria-label={localize(link.title)}
      className={cn(sidebarRowClassName, 'justify-start', active && sidebarRowActiveClassName)}
      onClick={() => onSelect(link)}
    >
      {Icon ? (
        <Icon
          className={cn(sidebarRowIconClassName, active && sidebarRowActiveIconClassName)}
          aria-hidden="true"
        />
      ) : null}
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
  const { data: startupConfig } = useGetStartupConfig();
  const [activeLink, setActiveLink] = useState<NavLink | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

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
    <div className="flex h-full w-full flex-shrink-0 flex-col items-center gap-2 px-2 pb-2 pt-2.5">
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
            className={sidebarIconButtonClassName}
            onClick={toggleClick}
          >
            <SidebarIcon aria-hidden="true" className="icon-md" />
          </Button>
        }
      />
      <NewChatIconButton />
      <SearchChatsRow variant="icon" />
      {/* В свёрнутой рельсе прототип прячет имя, но оставляет аватар: иначе до
          настроек и выхода не добраться, не развернув сайдбар. */}
      <div className="mt-auto">
        <Suspense fallback={<Skeleton className="h-8 w-8 rounded-lg" />}>
          <AccountSettings collapsed />
        </Suspense>
      </div>
    </div>
  );

  const fullPanel = (
    <div className="flex h-full w-full flex-shrink-0 flex-col px-2.5 pb-2 pt-2.5">
      {/* Шапка сайдбара — 50px против 52px у шапки рабочей области: с отступом
          карточки (8) и её рамкой логотип и селектор модели встают на одну ось
          (канон §4). Число проверено замером прототипа, не подобрано на глаз. */}
      <div className="flex h-[50px] flex-none items-center justify-between gap-2 px-1">
        <img
          src="assets/logo.svg"
          className="h-[18px] w-auto object-contain dark:invert"
          width={1920}
          height={648}
          alt={localize('com_ui_logo', { 0: startupConfig?.appTitle ?? '1ma' })}
        />
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
              className={sidebarIconButtonClassName}
              onClick={toggleClick}
            >
              <SidebarIcon aria-hidden="true" className="icon-md" />
            </Button>
          }
        />
      </div>

      {/* min-h-0 + overflow: on a short phone viewport THIS block gives way and
          scrolls, so the chats below keep their guaranteed minimum. On a
          desktop height nothing changes — the block fits and never scrolls. */}
      {/* 12.08-2, регрессия: внутри прокручиваемой колонки flex-дети по
          умолчанию СЖИМАЕМЫ — на телефоне строки меню сплющило вместо того,
          чтобы прокрутиться. Каждый ребёнок обязан держать свою высоту. */}
      <div className="flex min-h-0 flex-col overflow-y-auto overscroll-contain [&>*]:shrink-0">
        <NewChatRow />
        <SearchChatsRow />
        {/* The open section is the one whose panel is on screen — the only notion
            of "current section" this sidebar has: nothing here is routed. */}
        {menuLinks.map((link) => (
          <MenuRow
            key={link.id}
            link={link}
            active={dialogOpen && activeLink?.id === link.id}
            onSelect={handleSelect}
          />
        ))}
      </div>

      {/* 12.08, владелец (айфон): секции выше зажимали список чатов в ноль —
          «Чаты» открывались, а строк не было и скролла не было. Списку
          гарантирован минимум пяти строк; при нехватке высоты сжимается и
          прокручивается НАВИГАЦИЯ выше, а не чаты. */}
      <div className={cn('mt-3 min-h-[240px] flex-1 overflow-hidden')}>
        <ConversationsSection />
      </div>

      <div className="mt-auto flex-none border-t border-border-light px-1.5 pb-1.5 pt-2.5">
        <Suspense fallback={<Skeleton className="h-9 w-full rounded-xl" />}>
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
