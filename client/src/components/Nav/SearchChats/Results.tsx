import { memo, useEffect, useMemo, useRef } from 'react';
import { Spinner } from '@librechat/client';
import type { RefObject } from 'react';
import type { TConversation, TMessage, GroupedConversations } from 'librechat-data-provider';
import { useConversationsInfiniteQuery, useMessagesInfiniteQuery } from '~/data-provider';
import { groupConversationsByDate } from '~/utils';
import { useLocalize, useAuthContext, TranslationKeys } from '~/hooks';
import type { SearchItem } from './types';
import Item from './Item';

type SearchMessageHit = TMessage & { title?: string };

interface ResultsProps {
  query: string;
  onSelect: () => void;
  scrollRoot?: RefObject<HTMLDivElement | null>;
  activeId?: string;
  onItemsChange?: (items: SearchItem[]) => void;
}

const SNIPPET_MAX_LENGTH = 120;
const SNIPPET_CONTEXT_CHARS = 40;
const SENTINEL_ROOT_MARGIN = '120px';

function makeSnippet(text: string, query: string): string {
  if (!text) {
    return '';
  }
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= SNIPPET_MAX_LENGTH) {
    return flat;
  }
  const idx = flat.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) {
    return `${flat.slice(0, SNIPPET_MAX_LENGTH)}…`;
  }
  const start = Math.max(0, idx - SNIPPET_CONTEXT_CHARS);
  const end = Math.min(flat.length, idx + query.length + SNIPPET_CONTEXT_CHARS);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < flat.length ? '…' : '';
  return `${prefix}${flat.slice(start, end)}${suffix}`;
}

const Results = memo(function Results({
  query,
  onSelect,
  scrollRoot,
  activeId,
  onItemsChange,
}: ResultsProps) {
  const localize = useLocalize();
  const { isAuthenticated } = useAuthContext();
  const hasQuery = query.trim().length > 0;

  const recentsQuery = useConversationsInfiniteQuery(
    { search: undefined },
    {
      enabled: isAuthenticated && !hasQuery,
      staleTime: 30000,
      cacheTime: 300000,
    },
  );

  const conversationsSearchQuery = useConversationsInfiniteQuery(
    { search: hasQuery ? query : undefined },
    {
      enabled: isAuthenticated && hasQuery,
      staleTime: 30000,
      cacheTime: 300000,
    },
  );

  const messagesSearchQuery = useMessagesInfiniteQuery(
    { search: hasQuery ? query : undefined },
    {
      enabled: isAuthenticated && hasQuery,
      staleTime: 30000,
      cacheTime: 300000,
    },
  );

  const recentsGrouped = useMemo<GroupedConversations>(() => {
    if (hasQuery || !recentsQuery.data) {
      return [];
    }
    const all = recentsQuery.data.pages.flatMap((page) => page.conversations);
    return groupConversationsByDate(all);
  }, [hasQuery, recentsQuery.data]);

  const conversationHits = useMemo<TConversation[]>(() => {
    if (!hasQuery || !conversationsSearchQuery.data) {
      return [];
    }
    return conversationsSearchQuery.data.pages.flatMap((p) => p.conversations);
  }, [hasQuery, conversationsSearchQuery.data]);

  const messageHits = useMemo<SearchMessageHit[]>(() => {
    if (!hasQuery || !messagesSearchQuery.data) {
      return [];
    }
    return messagesSearchQuery.data.pages.flatMap((p) => p.messages as SearchMessageHit[]);
  }, [hasQuery, messagesSearchQuery.data]);

  const flatItems = useMemo<SearchItem[]>(() => {
    const items: SearchItem[] = [];
    if (!hasQuery) {
      for (const [, convos] of recentsGrouped) {
        for (const c of convos) {
          const cid = c.conversationId ?? '';
          if (!cid) {
            continue;
          }
          items.push({
            id: `r-${cid}`,
            conversationId: cid,
            title: c.title || localize('com_ui_new_chat'),
          });
        }
      }
      return items;
    }
    for (const c of conversationHits) {
      const cid = c.conversationId ?? '';
      if (!cid) {
        continue;
      }
      items.push({
        id: `c-${cid}`,
        conversationId: cid,
        title: c.title || localize('com_ui_new_chat'),
      });
    }
    for (const m of messageHits) {
      const cid = m.conversationId ?? '';
      if (!cid || !m.messageId) {
        continue;
      }
      items.push({
        id: `m-${m.messageId}`,
        conversationId: cid,
        messageId: m.messageId,
        title: m.title || localize('com_ui_new_chat'),
        snippet: makeSnippet(m.text ?? '', query),
      });
    }
    return items;
  }, [hasQuery, recentsGrouped, conversationHits, messageHits, query, localize]);

  useEffect(() => {
    onItemsChange?.(flatItems);
  }, [flatItems, onItemsChange]);

  const isLoading = hasQuery
    ? conversationsSearchQuery.isLoading || messagesSearchQuery.isLoading
    : recentsQuery.isLoading;

  const isFetchingNext =
    recentsQuery.isFetchingNextPage ||
    conversationsSearchQuery.isFetchingNextPage ||
    messagesSearchQuery.isFetchingNextPage;

  const sentinelRef = useRef<HTMLDivElement>(null);

  const recentsFetchNext = recentsQuery.fetchNextPage;
  const recentsHasNext = recentsQuery.hasNextPage;
  const recentsIsFetchingNext = recentsQuery.isFetchingNextPage;
  const convosFetchNext = conversationsSearchQuery.fetchNextPage;
  const convosHasNext = conversationsSearchQuery.hasNextPage;
  const convosIsFetchingNext = conversationsSearchQuery.isFetchingNextPage;
  const msgsFetchNext = messagesSearchQuery.fetchNextPage;
  const msgsHasNext = messagesSearchQuery.hasNextPage;
  const msgsIsFetchingNext = messagesSearchQuery.isFetchingNextPage;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) {
          return;
        }
        if (!hasQuery && recentsHasNext && !recentsIsFetchingNext) {
          recentsFetchNext();
          return;
        }
        if (hasQuery) {
          if (convosHasNext && !convosIsFetchingNext) {
            convosFetchNext();
          }
          if (msgsHasNext && !msgsIsFetchingNext) {
            msgsFetchNext();
          }
        }
      },
      {
        root: scrollRoot?.current ?? null,
        rootMargin: SENTINEL_ROOT_MARGIN,
        threshold: 0,
      },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [
    hasQuery,
    scrollRoot,
    recentsHasNext,
    recentsIsFetchingNext,
    recentsFetchNext,
    convosHasNext,
    convosIsFetchingNext,
    convosFetchNext,
    msgsHasNext,
    msgsIsFetchingNext,
    msgsFetchNext,
  ]);

  if (isLoading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Spinner className="text-text-primary" />
      </div>
    );
  }

  if (!hasQuery) {
    if (recentsGrouped.length === 0) {
      return (
        <div className="py-10 text-center text-sm text-text-secondary">
          {localize('com_nav_search_chats_empty')}
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-3">
        {recentsGrouped.map(([groupKey, convos]) => (
          <div key={groupKey} className="flex flex-col gap-0.5">
            <div className="px-3 pb-1 pt-2 text-xs font-medium text-text-secondary">
              {localize(groupKey as TranslationKeys) || groupKey.trim()}
            </div>
            {convos.map((c) => {
              const cid = c.conversationId ?? '';
              const itemId = `r-${cid}`;
              return (
                <Item
                  key={itemId}
                  id={itemId}
                  conversationId={cid}
                  title={c.title || localize('com_ui_new_chat')}
                  isActive={activeId === itemId}
                  onSelect={onSelect}
                />
              );
            })}
          </div>
        ))}
        <div ref={sentinelRef} aria-hidden="true" className="h-px" />
        {isFetchingNext ? (
          <div className="flex justify-center py-3">
            <Spinner className="text-text-primary" />
          </div>
        ) : null}
      </div>
    );
  }

  const hasResults = conversationHits.length > 0 || messageHits.length > 0;
  if (!hasResults) {
    return (
      <div className="py-10 text-center text-sm text-text-secondary">
        {localize('com_nav_search_chats_no_results')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {conversationHits.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          <div className="px-3 pb-1 pt-2 text-xs font-medium text-text-secondary">
            {localize('com_nav_search_chats_section_chats')}
          </div>
          {conversationHits.map((c) => {
            const cid = c.conversationId ?? '';
            const itemId = `c-${cid}`;
            return (
              <Item
                key={itemId}
                id={itemId}
                conversationId={cid}
                title={c.title || localize('com_ui_new_chat')}
                isActive={activeId === itemId}
                onSelect={onSelect}
              />
            );
          })}
        </div>
      ) : null}
      {messageHits.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          <div className="px-3 pb-1 pt-2 text-xs font-medium text-text-secondary">
            {localize('com_nav_search_chats_section_messages')}
          </div>
          {messageHits.map((m) => {
            const cid = m.conversationId ?? '';
            const itemId = `m-${m.messageId}`;
            return (
              <Item
                key={itemId}
                id={itemId}
                conversationId={cid}
                messageId={m.messageId}
                title={m.title || localize('com_ui_new_chat')}
                snippet={makeSnippet(m.text ?? '', query)}
                isActive={activeId === itemId}
                onSelect={onSelect}
              />
            );
          })}
        </div>
      ) : null}
      <div ref={sentinelRef} aria-hidden="true" className="h-px" />
      {isFetchingNext ? (
        <div className="flex justify-center py-3">
          <Spinner className="text-text-primary" />
        </div>
      ) : null}
    </div>
  );
});

export default Results;
