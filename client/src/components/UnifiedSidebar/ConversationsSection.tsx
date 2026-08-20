import { useCallback, useState, useMemo, useEffect, memo, useRef, lazy, Suspense } from 'react';
import { useSetRecoilState } from 'recoil';
import { useMediaQuery } from '@librechat/client';
import type { InfiniteQueryObserverResult } from '@tanstack/react-query';
import type { ConversationListResponse } from 'librechat-data-provider';
import type { List } from 'react-virtualized';
import type { NavLinkComponentProps } from '~/common';
import {
  useLocalize,
  useAuthContext,
  useLocalStorage,
  useNavScrolling,
  useBookmarksEnabled,
} from '~/hooks';
import {
  useConversationsInfiniteQuery,
  useGetConversationTags,
  useTitleGeneration,
} from '~/data-provider';
import { Conversations } from '~/components/Conversations';
import store from '~/store';

const BookmarkNav = lazy(() => import('~/components/Nav/Bookmarks/BookmarkNav'));

type ConversationsSectionProps = NavLinkComponentProps & {
  /** Единый скролл сайдбара (р21-4); в PanelDialog «История чатов» секция
   *  живёт без него и список держит собственную высоту. */
  scrollElement?: HTMLElement | null;
};

const ConversationsSection = memo(({ scrollElement }: ConversationsSectionProps) => {
  const localize = useLocalize();
  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  const setSidebarExpanded = useSetRecoilState(store.sidebarExpanded);
  const { isAuthenticated } = useAuthContext();
  useTitleGeneration(isAuthenticated);

  const [isChatsExpanded, setIsChatsExpanded] = useLocalStorage('chatsExpanded', true);
  const [showLoading, setShowLoading] = useState(false);
  const [tags, setTags] = useState<string[]>([]);

  const bookmarksEnabled = useBookmarksEnabled();
  /** Off means off: no request for a feature the client has not switched on. */
  const { data: bookmarks } = useGetConversationTags({ enabled: bookmarksEnabled });

  /** Hiding the control must also drop its filter, or the list stays narrowed with no way back. */
  const activeTags = bookmarksEnabled ? tags : [];

  /* A bookmark renamed or deleted from the panel takes its name with it. Left in the selection
   * it would filter the list by a name nothing carries any more, while the menu shows that
   * bookmark unselected — so drop what no longer exists, once the list is actually known. */
  useEffect(() => {
    if (!bookmarks) {
      return;
    }
    const known = new Set(bookmarks.map((bookmark) => bookmark.tag));
    setTags((current) =>
      current.every((tag) => known.has(tag)) ? current : current.filter((tag) => known.has(tag)),
    );
  }, [bookmarks]);

  const { data, fetchNextPage, isFetchingNextPage, isLoading } = useConversationsInfiniteQuery(
    {
      tags: activeTags.length === 0 ? undefined : activeTags,
    },
    {
      enabled: isAuthenticated,
      staleTime: 30000,
      cacheTime: 300000,
    },
  );

  const computedHasNextPage = useMemo(() => {
    if (data?.pages && data.pages.length > 0) {
      const lastPage: ConversationListResponse = data.pages[data.pages.length - 1];
      return lastPage.nextCursor !== null;
    }
    return false;
  }, [data?.pages]);

  const conversationsRef = useRef<List | null>(null);

  const { moveToTop } = useNavScrolling<ConversationListResponse>({
    setShowLoading,
    fetchNextPage: async (options?) => {
      if (computedHasNextPage) {
        return fetchNextPage(options);
      }
      return Promise.resolve({} as InfiniteQueryObserverResult<ConversationListResponse, unknown>);
    },
    isFetchingNext: isFetchingNextPage,
  });

  const conversations = useMemo(() => {
    return data ? data.pages.flatMap((page) => page.conversations) : [];
  }, [data]);

  const toggleNav = useCallback(() => {
    if (isSmallScreen) {
      setSidebarExpanded(false);
    }
  }, [isSmallScreen, setSidebarExpanded]);

  /* Built once per selection rather than per render: `Conversations` is memoized, and a fresh
   * element here would defeat that on every re-render a streaming reply causes. */
  const headerActions = useMemo(
    () =>
      bookmarksEnabled ? (
        <Suspense fallback={null}>
          <BookmarkNav tags={tags} setTags={setTags} />
        </Suspense>
      ) : null,
    [bookmarksEnabled, tags],
  );

  const loadMoreConversations = useCallback(() => {
    if (isFetchingNextPage || !computedHasNextPage) {
      return;
    }
    fetchNextPage();
  }, [isFetchingNextPage, computedHasNextPage, fetchNextPage]);

  return (
    /* Р21-4: в едином скролле панели секция — обычный блок (высоту списку даёт
       WindowScroller); в диалоге «История чатов» (без scrollElement) — прежний
       собственный скролл с зажатой высотой. */
    <div
      className={
        scrollElement
          ? 'flex flex-col pb-3 pt-2'
          : 'flex h-full min-h-0 flex-col overflow-hidden pb-3 pt-2'
      }
      role="region"
      aria-label={localize('com_ui_chat_history')}
    >
      <div
        className={
          scrollElement ? 'flex flex-col' : 'flex min-h-0 flex-grow flex-col overflow-hidden'
        }
      >
        <Conversations
          scrollElement={scrollElement}
          conversations={conversations}
          moveToTop={moveToTop}
          toggleNav={toggleNav}
          containerRef={conversationsRef}
          loadMoreConversations={loadMoreConversations}
          isLoading={isFetchingNextPage || showLoading || isLoading}
          isSearchLoading={false}
          isChatsExpanded={isChatsExpanded}
          setIsChatsExpanded={setIsChatsExpanded}
          showFavorites={false}
          headerActions={headerActions}
        />
      </div>
    </div>
  );
});

ConversationsSection.displayName = 'ConversationsSection';

export default ConversationsSection;
