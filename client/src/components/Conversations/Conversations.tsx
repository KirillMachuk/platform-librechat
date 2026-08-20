import { useMemo, memo, type FC, useCallback, useEffect, useRef } from 'react';
import throttle from 'lodash/throttle';
import { useRecoilValue } from 'recoil';
import { Spinner, useMediaQuery } from '@librechat/client';
import { List, CellMeasurer, CellMeasurerCache, WindowScroller } from 'react-virtualized';
import type { TConversation } from 'librechat-data-provider';
import { useLocalize, useFavorites, useShowMarketplace, useElementSize } from '~/hooks';
import FavoritesList from '~/components/Nav/Favorites/FavoritesList';
import { groupConversationsByDate, cn } from '~/utils';
import { ChevronDown } from '~/components/icons';
import { useActiveJobs } from '~/data-provider';
import Convo from './Convo';
import store from '~/store';

export type CellPosition = {
  columnIndex: number;
  rowIndex: number;
};

export type MeasuredCellParent = {
  invalidateCellSizeAfterRender?: ((cell: CellPosition) => void) | undefined;
  recomputeGridSize?: ((cell: CellPosition) => void) | undefined;
};

interface ConversationsProps {
  conversations: Array<TConversation | null>;
  moveToTop: () => void;
  toggleNav: () => void;
  containerRef: React.RefObject<List>;
  loadMoreConversations: () => void;
  isLoading: boolean;
  isSearchLoading: boolean;
  isChatsExpanded: boolean;
  setIsChatsExpanded: (expanded: boolean) => void;
  showFavorites?: boolean;
  headerActions?: React.ReactNode;
  /** Р21-4: внешний скроллер (единый скролл сайдбара). Задан — список едет
   *  внутри него через WindowScroller (autoHeight); нет — прежний режим с
   *  собственной высотой. */
  scrollElement?: HTMLElement | null;
}

interface MeasuredRowProps {
  cache: CellMeasurerCache;
  rowKey: string;
  parent: MeasuredCellParent;
  index: number;
  style: React.CSSProperties;
  children: React.ReactNode;
}

/** Reusable wrapper for virtualized row measurement */
const MeasuredRow: FC<MeasuredRowProps> = memo(
  ({ cache, rowKey, parent, index, style, children }) => (
    <CellMeasurer cache={cache} columnIndex={0} key={rowKey} parent={parent} rowIndex={index}>
      {({ registerChild }) => (
        <div ref={registerChild as React.LegacyRef<HTMLDivElement>} style={style}>
          {children}
        </div>
      )}
    </CellMeasurer>
  ),
);

MeasuredRow.displayName = 'MeasuredRow';

const LoadingSpinner = memo(() => {
  const localize = useLocalize();

  return (
    <div className="mx-auto mt-2 flex items-center justify-center gap-2">
      <Spinner className="text-text-primary" />
      <span className="animate-pulse text-text-primary">{localize('com_ui_loading')}</span>
    </div>
  );
});

LoadingSpinner.displayName = 'LoadingSpinner';

interface ChatsHeaderProps {
  isExpanded: boolean;
  onToggle: () => void;
  actions?: React.ReactNode;
}

/** Canon §1.8: one focus for the whole system — 2px `acc`, offset +2 on a
 *  standalone control. */
export const headerIconButtonClassName =
  'tap-target flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-secondary outline-none transition-colors duration-90 hover:bg-surface-hover hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus';

/** Collapsible header for the Chats section */
const ChatsHeader: FC<ChatsHeaderProps> = memo(({ isExpanded, onToggle, actions }) => {
  const localize = useLocalize();

  /** Канон §3: заголовок секции — 12,5/500 цвета t3, а не 12/700.
   *  Focus is §1.8 with offset −2: the control runs the full width of the row. */
  return (
    <div className="flex h-11 w-full items-center gap-0.5 pr-1 md:h-9">
      <button
        onClick={onToggle}
        className="group flex h-full min-w-0 flex-1 items-center gap-1 rounded-lg px-2.5 text-[12.5px] font-medium text-text-tertiary outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus"
        type="button"
        aria-expanded={isExpanded}
      >
        <span className="select-none truncate">{localize('com_ui_chats')}</span>
        <ChevronDown
          className={cn(
            'h-3 w-3 shrink-0 transition-transform duration-200',
            isExpanded ? '' : '-rotate-90',
          )}
          aria-hidden="true"
        />
      </button>
      {actions}
    </div>
  );
});

ChatsHeader.displayName = 'ChatsHeader';

type FlattenedItem =
  | { type: 'favorites' }
  | { type: 'convo'; convo: TConversation }
  | { type: 'loading' };

const Conversations: FC<ConversationsProps> = ({
  conversations: rawConversations,
  moveToTop,
  toggleNav,
  containerRef,
  loadMoreConversations,
  isLoading,
  isSearchLoading,
  isChatsExpanded,
  setIsChatsExpanded,
  showFavorites = true,
  headerActions,
  scrollElement,
}) => {
  const localize = useLocalize();
  const search = useRecoilValue(store.search);
  const { favorites, isLoading: isFavoritesLoading } = useFavorites();
  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  /** Первая оценка высоты строки до замера — канонные 44 на телефоне и 40 на
   *  десктопе, иначе список дёргается на первом кадре. */
  const convoHeight = isSmallScreen ? 44 : 40;
  const showAgentMarketplace = useShowMarketplace();
  const {
    ref: listContainerRef,
    width: listWidth,
    height: listHeight,
  } = useElementSize<HTMLDivElement>();

  const favoritesContentKeyRef = useRef('');

  // Fetch active job IDs for showing generation indicators
  const { data: activeJobsData } = useActiveJobs();
  const activeJobIds = useMemo(
    () => new Set(activeJobsData?.activeJobIds ?? []),
    [activeJobsData?.activeJobIds],
  );

  // Determine if FavoritesList will render content
  const shouldShowFavorites =
    showFavorites &&
    !search.query &&
    (isFavoritesLoading || favorites.length > 0 || showAgentMarketplace);

  favoritesContentKeyRef.current = `${favorites.length}-${showAgentMarketplace ? 1 : 0}-${isFavoritesLoading ? 1 : 0}`;

  const filteredConversations = useMemo(
    () => rawConversations.filter(Boolean) as TConversation[],
    [rawConversations],
  );

  const groupedConversations = useMemo(
    () => groupConversationsByDate(filteredConversations),
    [filteredConversations],
  );

  const flattenedItems = useMemo(() => {
    const items: FlattenedItem[] = [];
    // Only include favorites row if FavoritesList will render content
    if (shouldShowFavorites) {
      items.push({ type: 'favorites' });
    }

    if (isChatsExpanded) {
      groupedConversations.forEach(([, convos]) => {
        items.push(...convos.map((convo) => ({ type: 'convo' as const, convo })));
      });

      if (isLoading) {
        items.push({ type: 'loading' } as any);
      }
    }
    return items;
  }, [groupedConversations, isLoading, isChatsExpanded, shouldShowFavorites]);

  // Store flattenedItems in a ref for keyMapper to access without recreating cache
  const flattenedItemsRef = useRef(flattenedItems);
  flattenedItemsRef.current = flattenedItems;

  // Create a stable cache that doesn't depend on flattenedItems
  const cache = useMemo(
    () =>
      new CellMeasurerCache({
        fixedWidth: true,
        defaultHeight: convoHeight,
        keyMapper: (index) => {
          const item = flattenedItemsRef.current[index];
          if (!item) {
            return `unknown-${index}`;
          }
          if (item.type === 'favorites') {
            return `favorites-${favoritesContentKeyRef.current}`;
          }
          if (item.type === 'convo') {
            return `convo-${item.convo.conversationId}`;
          }
          if (item.type === 'loading') {
            return 'loading';
          }
          return `unknown-${index}`;
        },
      }),
    [convoHeight],
  );

  const clearFavoritesCache = useCallback(() => {
    if (cache) {
      cache.clear(0, 0);
      if (containerRef.current && 'recomputeRowHeights' in containerRef.current) {
        containerRef.current.recomputeRowHeights(0);
      }
    }
  }, [cache, containerRef]);

  useEffect(() => {
    const frameId = requestAnimationFrame(() => {
      clearFavoritesCache();
    });
    return () => cancelAnimationFrame(frameId);
  }, [favorites.length, isFavoritesLoading, showAgentMarketplace, clearFavoritesCache]);

  useEffect(() => {
    const frameId = requestAnimationFrame(() => {
      cache.clearAll();
      if (containerRef.current && 'recomputeRowHeights' in containerRef.current) {
        containerRef.current.recomputeRowHeights(0);
      }
    });
    return () => cancelAnimationFrame(frameId);
  }, [search.query, cache, containerRef]);

  /** Grid only re-derives row offsets when the row count changes; reorders that
   *  keep the count (e.g. a convo bumped across date groups) need an explicit recompute. */
  useEffect(() => {
    const frameId = requestAnimationFrame(() => {
      if (containerRef.current && 'recomputeRowHeights' in containerRef.current) {
        containerRef.current.recomputeRowHeights(0);
      }
    });
    return () => cancelAnimationFrame(frameId);
  }, [flattenedItems, containerRef]);

  const rowRenderer = useCallback(
    ({ index, key, parent, style }) => {
      const item = flattenedItems[index];
      const rowProps = { cache, rowKey: key, parent, index, style };

      if (item.type === 'loading') {
        return (
          <MeasuredRow key={key} {...rowProps}>
            <LoadingSpinner />
          </MeasuredRow>
        );
      }

      if (item.type === 'favorites') {
        return (
          <MeasuredRow key={key} {...rowProps}>
            <FavoritesList isSmallScreen={isSmallScreen} toggleNav={toggleNav} />
          </MeasuredRow>
        );
      }

      if (item.type === 'convo') {
        const isGenerating = activeJobIds.has(item.convo.conversationId ?? '');
        return (
          <MeasuredRow key={key} {...rowProps}>
            <Convo
              conversation={item.convo}
              retainView={moveToTop}
              toggleNav={toggleNav}
              isGenerating={isGenerating}
            />
          </MeasuredRow>
        );
      }

      return null;
    },
    [cache, flattenedItems, moveToTop, toggleNav, isSmallScreen, activeJobIds],
  );

  const getRowHeight = useCallback(
    ({ index }: { index: number }) => cache.getHeight(index, 0),
    [cache],
  );

  const throttledLoadMore = useMemo(
    () => throttle(loadMoreConversations, 300),
    [loadMoreConversations],
  );

  const handleRowsRendered = useCallback(
    ({ stopIndex }: { stopIndex: number }) => {
      if (stopIndex >= flattenedItems.length - 8) {
        throttledLoadMore();
      }
    },
    [flattenedItems.length, throttledLoadMore],
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col pb-2 text-sm text-text-primary">
      <div>
        <ChatsHeader
          isExpanded={isChatsExpanded}
          onToggle={() => setIsChatsExpanded(!isChatsExpanded)}
          actions={headerActions}
        />
      </div>
      {isSearchLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner className="text-text-primary" />
          <span className="ml-2 text-text-primary">{localize('com_ui_loading')}</span>
        </div>
      ) : (
        <div
          ref={listContainerRef}
          className={scrollElement ? 'min-w-0' : 'min-h-0 flex-1 overflow-hidden'}
        >
          {scrollElement ? (
            /* Р21-4: единый скролл сайдбара — высоту и позицию листу диктует
               внешний скроллер, у списка нет собственной полосы. Прежний
               overscroll-забор (р19) переехал на сам скроллер панели. */
            <WindowScroller scrollElement={scrollElement}>
              {({ height, isScrolling, registerChild, onChildScroll, scrollTop }) => (
                <div ref={registerChild as unknown as React.Ref<HTMLDivElement>}>
                  <List
                    autoHeight
                    ref={containerRef}
                    width={listWidth}
                    height={height || 0}
                    isScrolling={isScrolling}
                    onScroll={onChildScroll}
                    scrollTop={scrollTop}
                    deferredMeasurementCache={cache}
                    rowCount={flattenedItems.length}
                    rowHeight={getRowHeight}
                    rowRenderer={rowRenderer}
                    overscanRowCount={10}
                    aria-readonly={false}
                    className="outline-none"
                    aria-label={localize('com_ui_chats')}
                    onRowsRendered={handleRowsRendered}
                    tabIndex={-1}
                    style={{ outline: 'none' }}
                    containerRole="rowgroup"
                  />
                </div>
              )}
            </WindowScroller>
          ) : (
            <List
              ref={containerRef}
              width={listWidth}
              height={listHeight}
              deferredMeasurementCache={cache}
              rowCount={flattenedItems.length}
              rowHeight={getRowHeight}
              rowRenderer={rowRenderer}
              overscanRowCount={10}
              aria-readonly={false}
              /* overscroll-contain: the ONE scroller the r11 sweep could not
                 class-annotate (react-virtualized renders it) — without it a
                 swipe at the list's top edge chains to the page behind the
                 phone drawer and the platform steals the gesture (owner 19.08). */
              className="scrollbar-hover overscroll-contain outline-none"
              aria-label={localize('com_ui_chats')}
              onRowsRendered={handleRowsRendered}
              tabIndex={-1}
              style={{ outline: 'none' }}
              containerRole="rowgroup"
            />
          )}
        </div>
      )}
    </div>
  );
};

export default memo(Conversations);
