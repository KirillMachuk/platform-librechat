import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { JSX } from 'react/jsx-runtime';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowUp, ArrowDown, ArrowDownUp } from 'lucide-react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type SortingState,
  type VisibilityState,
  type ColumnDef,
  type Row,
  type ColumnFiltersState,
  type PaginationState,
} from '@tanstack/react-table';
import type { DataTableProps, RowWithId } from './DataTable.types';
import { SelectionCheckbox, MemoizedTableRow, SkeletonRows } from './DataTableComponents';
import { Table, TableBody, TableHead, TableHeader, TableCell, TableRow } from '../Table';
import { useDebounced, useOptimizedRowSelection } from './DataTable.hooks';
import { DataTableColumnVisibility } from './DataTableColumnVisibility';
import { useMediaQuery, useLocalize } from '~/hooks';
import { DataTableSearch } from './DataTableSearch';
import { cn, logger } from '~/utils';
import { Button } from '../Button';
import { Label } from '../Label';
import { Spinner } from '~/svgs';

/* Shallow equality for plain objects (string-keyed values, single level).
 * Accepts any object type; access is keyed via Object.keys so the generic
 * does not require a string index signature. */
function shallowEqualObject<T extends object>(a: T, b: T): boolean {
  if (a === b) return true;
  const aKeys = Object.keys(a) as Array<keyof T>;
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i++) {
    const k = aKeys[i];
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (a[k] !== b[k]) return false;
  }
  return true;
}

/* Shallow equality for arrays of plain objects (e.g. SortingState,
 * ColumnFiltersState). Two arrays are equal when they have the same
 * length and each corresponding element is shallow-equal as an object. */
function shallowEqualArrayOfObjects<T extends object>(a: T[], b: T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!shallowEqualObject(a[i], b[i])) return false;
  }
  return true;
}

function DataTable<TData extends RowWithId, TValue>({
  columns,
  data,
  className = '',
  isLoading = false,
  isFetching = false,
  config,
  filterValue = '',
  onFilterChange,
  defaultSort = [],
  isFetchingNextPage = false,
  hasNextPage = false,
  fetchNextPage,
  sorting,
  onSortingChange,
  customActionsRenderer,
  onRowClick,
}: DataTableProps<TData, TValue>): JSX.Element {
  const localize = useLocalize();
  const isSmallScreen = useMediaQuery('(max-width: 768px)');

  const tableContainerRef = useRef<HTMLDivElement>(null);
  const scrollTimeoutRef = useRef<number | null>(null);
  const scrollRAFRef = useRef<number | null>(null);

  const cfg = config ?? {};
  const { enableRowSelection = true, showCheckboxes = true } = cfg.selection ?? {};
  const { enableSearch = true, debounce: debounceDelay = 300, filterColumn } = cfg.search ?? {};
  const { count: skeletonCount = 10 } = cfg.skeleton ?? {};
  const {
    overscan = 10,
    minRows = 50,
    rowHeight = 56,
    fastOverscanMultiplier = 4,
  } = cfg.virtualization ?? {};
  const {
    manualSorting = true,
    manualFiltering = true,
    enablePagination = false,
    pageSize: configuredPageSize = 10,
  } = cfg.behavior ?? {};
  const { enabled: columnVisibilityEnabled = false, contextMap: columnVisibilityContextMap } =
    cfg.columnVisibility ?? {};

  const paginationActive = enablePagination;
  const virtualizationActive = !paginationActive && data.length >= minRows;

  // Dynamic overscan for fast scrolling - increases rendered rows during rapid scroll.
  // `dynamicOverscan` drives the virtualizer (needs to be reactive state),
  // `dynamicOverscanRef` mirrors it for the scroll handler's read-only checks —
  // putting it in the handler's deps would tear down the scroll listener on
  // every overscan boost (i.e. constantly during fast scrolls).
  const [dynamicOverscan, setDynamicOverscan] = useState(overscan);
  const dynamicOverscanRef = useRef(overscan);
  useEffect(() => {
    dynamicOverscanRef.current = dynamicOverscan;
  }, [dynamicOverscan]);
  const lastScrollTopRef = useRef(0);
  const lastScrollTimeRef = useRef(performance.now());
  const fastScrollTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    setDynamicOverscan(overscan);
  }, [overscan]);

  /* Column visibility comes from two sources:
   *   1. `calculatedVisibility` — derived from column meta (e.g. `desktopOnly`),
   *      a pure function of props.
   *   2. `userColumnVisibility` — user toggles via the visibility dropdown.
   * Merging via a derived `useMemo` (see below) instead of pushing into a
   * single `useState` via `useEffect` is what kills the infinite re-render
   * loop: a non-memoized `columns` prop would otherwise create a fresh
   * `calculatedVisibility` ref every render, fire the effect, mutate state,
   * re-render — ad infinitum. With the derived approach the visibility
   * value is recomputed on render but never causes its own re-render. */
  const [userColumnVisibility, setUserColumnVisibilityRaw] = useState<VisibilityState>({});
  /* Equality-guarded setters: react-table's onXChange callbacks re-emit
   * a fresh state object on every render even when the logical value
   * hasn't changed. Without bailout, those setState calls trigger
   * re-renders, which re-emit, which re-render — infinite loop. The
   * wrappers below short-circuit when prev and next are shallow-equal
   * so React's Object.is bailout kicks in and the render stops. */
  const setUserColumnVisibility = useCallback<typeof setUserColumnVisibilityRaw>(
    (updater) =>
      setUserColumnVisibilityRaw((prev) => {
        const next =
          typeof updater === 'function'
            ? (updater as (p: VisibilityState) => VisibilityState)(prev)
            : updater;
        return shallowEqualObject(prev, next) ? prev : next;
      }),
    [],
  );
  const [optimizedRowSelection, setOptimizedRowSelectionRaw] = useOptimizedRowSelection();
  const setOptimizedRowSelection = useCallback<typeof setOptimizedRowSelectionRaw>(
    (updater) =>
      setOptimizedRowSelectionRaw((prev) => {
        const next =
          typeof updater === 'function'
            ? (updater as (p: Record<string, boolean>) => Record<string, boolean>)(prev)
            : updater;
        return shallowEqualObject(prev, next) ? prev : next;
      }),
    [setOptimizedRowSelectionRaw],
  );
  const [searchTerm, setSearchTerm] = useState(filterValue);
  const [internalSorting, setInternalSortingRaw] = useState<SortingState>(defaultSort);
  const setInternalSorting = useCallback<typeof setInternalSortingRaw>(
    (updater) =>
      setInternalSortingRaw((prev) => {
        const next =
          typeof updater === 'function'
            ? (updater as (p: SortingState) => SortingState)(prev)
            : updater;
        return shallowEqualArrayOfObjects(prev, next) ? prev : next;
      }),
    [],
  );

  const selectedCount = Object.keys(optimizedRowSelection).length;
  const isAllSelected = useMemo(
    () => data.length > 0 && selectedCount === data.length,
    [data.length, selectedCount],
  );
  const isIndeterminate = selectedCount > 0 && !isAllSelected;

  const getRowId = useCallback((row: TData) => String(row.id), []);

  const selectedRows = useMemo(() => {
    if (Object.keys(optimizedRowSelection).length === 0) return [];

    const dataMap = new Map(data.map((item) => [getRowId(item), item]));
    return Object.keys(optimizedRowSelection)
      .map((id) => dataMap.get(id))
      .filter(Boolean) as TData[];
  }, [optimizedRowSelection, data, getRowId]);

  const cleanupTimers = useCallback(() => {
    if (scrollRAFRef.current != null) {
      cancelAnimationFrame(scrollRAFRef.current);
      scrollRAFRef.current = null;
    }
    if (scrollTimeoutRef.current != null) {
      clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = null;
    }
    if (fastScrollTimeoutRef.current != null) {
      clearTimeout(fastScrollTimeoutRef.current);
      fastScrollTimeoutRef.current = null;
    }
  }, []);

  const debouncedTerm = useDebounced(searchTerm, debounceDelay);
  const finalSorting = sorting ?? internalSorting;

  /* Pre-seed visibility state for columns that opt into the
   * `desktopOnly` flag. The actual mobile hiding is done via CSS
   * (`hidden md:table-cell`); the keys are seeded so the user-toggle
   * dropdown and react-table's internal book-keeping line up with the
   * column ids. Pure function of `columns` — no other inputs. */
  const calculatedVisibility = useMemo(() => {
    const newVisibility: VisibilityState = {};

    columns.forEach((col) => {
      if (!col.meta?.desktopOnly) return;

      const rawId = col.id ?? col.accessorKey;

      if ((typeof rawId === 'string' || typeof rawId === 'number') && String(rawId).length > 0) {
        newVisibility[String(rawId)] = true;
      } else {
        logger.warn(
          'DataTable: A desktopOnly column is missing id/accessorKey; cannot control header visibility automatically.',
          col,
        );
      }
    });
    return newVisibility;
    /* isSmallScreen is intentionally a dependency: it forces a fresh result
       reference when the viewport crosses the mobile breakpoint so the effect
       below re-applies column visibility, even though the body doesn't read it. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSmallScreen, columns]);

  const columnVisibility = useMemo<VisibilityState>(
    () => ({ ...calculatedVisibility, ...userColumnVisibility }),
    [calculatedVisibility, userColumnVisibility],
  );

  const tableColumns = useMemo((): ColumnDef<TData, TValue>[] => {
    if (!enableRowSelection || !showCheckboxes) {
      return columns;
    }

    const selectColumn: ColumnDef<TData, TValue> = {
      id: 'select',
      enableResizing: false,
      header: () => {
        const extraCheckboxProps = (isIndeterminate ? { indeterminate: true } : {}) as Record<
          string,
          unknown
        >;
        return (
          <div
            className="flex h-full items-center justify-center"
            aria-label={localize('com_ui_select_all')}
          >
            <SelectionCheckbox
              checked={isAllSelected}
              onChange={(value) => {
                if (isAllSelected || !value) {
                  setOptimizedRowSelection({});
                } else {
                  const allSelection = data.reduce<Record<string, boolean>>((acc, item) => {
                    acc[getRowId(item)] = true;
                    return acc;
                  }, {});
                  setOptimizedRowSelection(allSelection);
                }
              }}
              ariaLabel={localize('com_ui_select_all')}
              {...extraCheckboxProps}
            />
          </div>
        );
      },
      cell: ({ row }) => {
        const named = (row.original as { name?: string }).name;
        const rowDescription = named ? `named ${named}` : `at position ${row.index + 1}`;
        return (
          <div
            className="flex h-full items-center justify-center"
            role="button"
            tabIndex={0}
            aria-label={localize(`com_ui_select_row`, { 0: rowDescription })}
          >
            <SelectionCheckbox
              checked={row.getIsSelected()}
              onChange={(value) => row.toggleSelected(value)}
              ariaLabel={localize(`com_ui_select_row`, { 0: rowDescription })}
            />
          </div>
        );
      },
      meta: {
        className: 'max-w-[20px] flex-1',
      },
    };

    return [selectColumn, ...columns];
  }, [
    columns,
    enableRowSelection,
    showCheckboxes,
    localize,
    data,
    getRowId,
    isAllSelected,
    isIndeterminate,
    setOptimizedRowSelection,
  ]);

  const sizedColumns = tableColumns;

  const [columnFilters, setColumnFiltersRaw] = useState<ColumnFiltersState>([]);
  const setColumnFilters = useCallback<typeof setColumnFiltersRaw>(
    (updater) =>
      setColumnFiltersRaw((prev) => {
        const next =
          typeof updater === 'function'
            ? (updater as (p: ColumnFiltersState) => ColumnFiltersState)(prev)
            : updater;
        return shallowEqualArrayOfObjects(prev, next) ? prev : next;
      }),
    [],
  );
  const [pagination, setPaginationRaw] = useState<PaginationState>(() => ({
    pageIndex: 0,
    pageSize: configuredPageSize,
  }));
  const setPagination = useCallback<typeof setPaginationRaw>(
    (updater) =>
      setPaginationRaw((prev) => {
        const next =
          typeof updater === 'function'
            ? (updater as (p: PaginationState) => PaginationState)(prev)
            : updater;
        return shallowEqualObject(prev, next) ? prev : next;
      }),
    [],
  );

  /* Sync pagination.pageSize when consumer changes `config.behavior.pageSize`
   * (e.g. responsive layout swaps 10 → 5 on mobile). Without this the initial
   * useState seed wins forever. The equality-guarded setter prevents an
   * unnecessary state churn when pageSize is unchanged. */
  useEffect(() => {
    setPagination((prev) =>
      prev.pageSize === configuredPageSize ? prev : { pageIndex: 0, pageSize: configuredPageSize },
    );
  }, [configuredPageSize, setPagination]);

  const onRowClickRef = useRef(onRowClick);
  useEffect(() => {
    onRowClickRef.current = onRowClick;
  }, [onRowClick]);

  const stableOnRowClick = useMemo<((row: TData) => void) | undefined>(
    () =>
      onRowClick == null
        ? undefined
        : (row: TData) => {
            onRowClickRef.current?.(row);
          },
    [onRowClick == null],
  );

  const rowStyle = useMemo<React.CSSProperties>(() => ({ height: rowHeight }), [rowHeight]);

  const table = useReactTable<TData>({
    data,
    columns: sizedColumns,
    getRowId: getRowId,
    getCoreRowModel: getCoreRowModel(),
    ...(manualSorting ? {} : { getSortedRowModel: getSortedRowModel() }),
    ...(manualFiltering ? {} : { getFilteredRowModel: getFilteredRowModel() }),
    ...(paginationActive ? { getPaginationRowModel: getPaginationRowModel() } : {}),
    enableRowSelection,
    enableMultiRowSelection: true,
    manualSorting,
    manualFiltering,
    state: {
      sorting: finalSorting,
      columnVisibility,
      rowSelection: optimizedRowSelection,
      ...(manualFiltering ? {} : { columnFilters }),
      ...(paginationActive ? { pagination } : {}),
    },
    onSortingChange: onSortingChange ?? setInternalSorting,
    onColumnVisibilityChange: setUserColumnVisibility,
    onRowSelectionChange: setOptimizedRowSelection,
    ...(manualFiltering ? {} : { onColumnFiltersChange: setColumnFilters }),
    ...(paginationActive ? { onPaginationChange: setPagination } : {}),
  });

  /* Stable callbacks for useVirtualizer options. react-virtual reinstalls
   * scroll observers and recomputes measurements when these references churn,
   * which under jsdom (no real layout) cascades into an infinite
   * useLayoutEffect → flushSync(rerender) loop. Stabilising them keeps the
   * virtualizer's internal scrollElement equality check a no-op after mount. */
  const getScrollElement = useCallback(() => tableContainerRef.current, []);
  const getItemKeyForVirtualizer = useCallback(
    (index: number) => getRowId(data[index] as TData),
    [data, getRowId],
  );
  const estimateSize = useCallback(() => rowHeight, [rowHeight]);
  const rowVirtualizer = useVirtualizer({
    enabled: virtualizationActive,
    count: data.length,
    getScrollElement,
    getItemKey: getItemKeyForVirtualizer,
    estimateSize,
    overscan: dynamicOverscan,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();
  const paddingTop = virtualRows[0]?.start ?? 0;
  const paddingBottom =
    virtualRows.length > 0 ? totalSize - (virtualRows[virtualRows.length - 1]?.end ?? 0) : 0;

  const { rows } = table.getRowModel();
  const headerGroups = table.getHeaderGroups();

  const showSkeletons = isLoading || (isFetching && !isFetchingNextPage);
  const shouldShowSearch =
    enableSearch && (onFilterChange != null || (!manualFiltering && filterColumn != null));

  // Render table body based on loading state and virtualization
  let tableBodyContent: React.ReactNode;
  if (showSkeletons) {
    tableBodyContent = (
      <SkeletonRows
        count={skeletonCount}
        columns={tableColumns as ColumnDef<Record<string, unknown>>[]}
      />
    );
  } else if (virtualizationActive) {
    tableBodyContent = (
      <>
        {paddingTop > 0 && (
          <TableRow aria-hidden="true">
            <TableCell
              colSpan={tableColumns.length}
              style={{ height: paddingTop, padding: 0, border: 0 }}
            />
          </TableRow>
        )}
        {virtualRows.map((virtualRow) => {
          const row = rows[virtualRow.index];
          if (!row) return null;

          return (
            <MemoizedTableRow
              key={virtualRow.key}
              row={row as unknown as Row<Record<string, unknown>>}
              virtualIndex={virtualRow.index}
              selected={row.getIsSelected()}
              style={rowStyle}
              onRowClick={stableOnRowClick as ((row: Record<string, unknown>) => void) | undefined}
              isSmallScreen={isSmallScreen}
            />
          );
        })}
        {paddingBottom > 0 && (
          <TableRow aria-hidden="true">
            <TableCell
              colSpan={tableColumns.length}
              style={{ height: paddingBottom, padding: 0, border: 0 }}
            />
          </TableRow>
        )}
      </>
    );
  } else {
    tableBodyContent = rows.map((row) => (
      <MemoizedTableRow
        key={getRowId(row.original as TData)}
        row={row as unknown as Row<Record<string, unknown>>}
        virtualIndex={row.index}
        selected={row.getIsSelected()}
        style={rowStyle}
        onRowClick={stableOnRowClick as ((row: Record<string, unknown>) => void) | undefined}
        isSmallScreen={isSmallScreen}
      />
    ));
  }

  useEffect(() => {
    setSearchTerm(filterValue);
  }, [filterValue]);

  useEffect(() => {
    if (onFilterChange) {
      /* Controlled mode: the echo guard compares against the prop so a parent
       * round-tripping the same value doesn't loop. */
      if (debouncedTerm !== filterValue) {
        onFilterChange(debouncedTerm);
        setOptimizedRowSelection({});
      }
      return;
    }
    if (!manualFiltering && filterColumn) {
      /* Uncontrolled mode: compare against the column's actual filter, NOT the
       * `filterValue` prop — that prop defaults to '' here, and clearing the
       * input also yields '', so a prop-based guard swallowed the reset and the
       * table stayed filtered on the previous term forever. */
      const column = table.getColumn(filterColumn);
      const next = debouncedTerm.length > 0 ? debouncedTerm : undefined;
      if (column && column.getFilterValue() !== next) {
        column.setFilterValue(next);
        setOptimizedRowSelection({});
      }
    }
  }, [
    debouncedTerm,
    filterValue,
    onFilterChange,
    setOptimizedRowSelection,
    manualFiltering,
    filterColumn,
    table,
  ]);

  // Recalculate virtual range when data or state changes
  useEffect(() => {
    if (!virtualizationActive) return;
    rowVirtualizer.calculateRange();
  }, [data.length, finalSorting, columnVisibility, virtualizationActive, rowVirtualizer]);

  // Recalculate when container is resized
  useEffect(() => {
    if (!virtualizationActive) return;
    const container = tableContainerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      rowVirtualizer.calculateRange();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [virtualizationActive, rowVirtualizer]);

  const handleScroll = useCallback(() => {
    if (scrollRAFRef.current != null) cancelAnimationFrame(scrollRAFRef.current);

    scrollRAFRef.current = requestAnimationFrame(() => {
      scrollRAFRef.current = null;
      const container = tableContainerRef.current;
      if (container) {
        const now = performance.now();
        const delta = Math.abs(container.scrollTop - lastScrollTopRef.current);
        const dt = now - lastScrollTimeRef.current;
        if (dt > 0) {
          const velocity = delta / dt;
          // Increase overscan during fast scrolling for smoother experience
          if (velocity > 2 && virtualizationActive && dynamicOverscanRef.current === overscan) {
            if (fastScrollTimeoutRef.current != null) {
              window.clearTimeout(fastScrollTimeoutRef.current);
            }
            setDynamicOverscan(Math.min(overscan * fastOverscanMultiplier, overscan * 8));
            fastScrollTimeoutRef.current = window.setTimeout(() => {
              fastScrollTimeoutRef.current = null;
              setDynamicOverscan((current) => (current !== overscan ? overscan : current));
            }, 160);
          }
        }
        lastScrollTopRef.current = container.scrollTop;
        lastScrollTimeRef.current = now;
      }

      if (scrollTimeoutRef.current != null) clearTimeout(scrollTimeoutRef.current);

      // Trigger infinite scroll pagination
      scrollTimeoutRef.current = window.setTimeout(() => {
        scrollTimeoutRef.current = null;
        const loaderContainer = tableContainerRef.current;
        if (!loaderContainer || !fetchNextPage || !hasNextPage || isFetchingNextPage) return;

        const { scrollTop, scrollHeight, clientHeight } = loaderContainer;
        if (scrollTop + clientHeight >= scrollHeight - 200) {
          void fetchNextPage().catch((err) => {
            logger.warn('DataTable: fetchNextPage failed', err);
          });
        }
      }, 100);
    });
  }, [
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    overscan,
    fastOverscanMultiplier,
    virtualizationActive,
  ]);

  useEffect(() => {
    const scrollElement = tableContainerRef.current;
    if (!scrollElement) return;

    scrollElement.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      scrollElement.removeEventListener('scroll', handleScroll);
      cleanupTimers();
    };
  }, [handleScroll, cleanupTimers]);

  return (
    <div
      className={cn(
        'relative flex w-full flex-col overflow-hidden rounded-lg border border-border-light bg-background',
        'h-[calc(100vh-8rem)] max-h-[80vh]',
        className,
      )}
      role="region"
      aria-label={localize('com_ui_data_table')}
    >
      {(shouldShowSearch ||
        customActionsRenderer != null ||
        (columnVisibilityEnabled && columnVisibilityContextMap != null)) && (
        <div className="flex w-full shrink-0 items-center gap-2 border-b border-border-light md:gap-3">
          {shouldShowSearch && <DataTableSearch value={searchTerm} onChange={setSearchTerm} />}
          {customActionsRenderer &&
            customActionsRenderer({
              selectedCount,
              selectedRows,
              table,
            })}
          {columnVisibilityEnabled && columnVisibilityContextMap && (
            <div className="px-2 md:px-3">
              <DataTableColumnVisibility
                table={table}
                contextMap={columnVisibilityContextMap}
                isSmallScreen={isSmallScreen}
              />
            </div>
          )}
        </div>
      )}
      <div
        ref={tableContainerRef}
        className="overflow-anchor-none relative min-h-0 flex-1 overflow-auto will-change-scroll"
        style={
          {
            WebkitOverflowScrolling: 'touch',
            overscrollBehavior: 'contain',
          } as React.CSSProperties
        }
        role="region"
        aria-label={localize('com_ui_data_table_scroll_area')}
        aria-describedby={showSkeletons ? 'loading-status' : undefined}
      >
        <Table
          role="table"
          aria-label={localize('com_ui_data_table')}
          aria-rowcount={data.length}
          className="table-auto"
          unwrapped={true}
        >
          <TableHeader className="sticky top-0 z-10 bg-surface-secondary">
            {headerGroups.map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const isDesktopOnly =
                    (header.column.columnDef.meta as { desktopOnly?: boolean } | undefined)
                      ?.desktopOnly ?? false;

                  if (!header.column.getIsVisible()) {
                    return null;
                  }

                  const isSelectHeader = header.id === 'select';
                  const meta = header.column.columnDef.meta as
                    | { className?: string; customHeader?: boolean }
                    | undefined;
                  const hasCustomHeader = meta?.customHeader === true;
                  const canSort = header.column.getCanSort();
                  const wrapperSortable = canSort && !hasCustomHeader;

                  let sortAriaLabel: string | undefined;
                  if (wrapperSortable) {
                    const sortState = header.column.getIsSorted();
                    let sortStateLabel = 'sortable';
                    if (sortState === 'asc') {
                      sortStateLabel = 'ascending';
                    } else if (sortState === 'desc') {
                      sortStateLabel = 'descending';
                    }

                    const headerLabel =
                      typeof header.column.columnDef.header === 'string'
                        ? header.column.columnDef.header
                        : header.column.id;

                    sortAriaLabel = `${headerLabel ?? ''} column, ${sortStateLabel}`;
                  }

                  const handleSortingKeyDown = (e: React.KeyboardEvent) => {
                    if (wrapperSortable && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      header.column.toggleSorting();
                    }
                  };

                  const metaWidth = (header.column.columnDef.meta as { width?: number } | undefined)
                    ?.width;
                  let widthStyle: React.CSSProperties = {};
                  if (isSelectHeader) {
                    widthStyle = { width: '32px', maxWidth: '32px', minWidth: '32px' };
                  } else if (metaWidth != null && metaWidth >= 1 && metaWidth <= 100) {
                    widthStyle = {
                      width: `${metaWidth}%`,
                      maxWidth: `${metaWidth}%`,
                      minWidth: `${metaWidth}%`,
                    };
                  }

                  const sortDirection = header.column.getIsSorted();
                  let ariaSort: 'ascending' | 'descending' | undefined;
                  if (sortDirection === 'asc') {
                    ariaSort = 'ascending';
                  } else if (sortDirection === 'desc') {
                    ariaSort = 'descending';
                  }
                  return (
                    <TableHead
                      key={header.id}
                      scope="col"
                      className={cn(
                        'border-b border-border-light px-2 py-2 md:px-3 md:py-2',
                        isSelectHeader && 'px-0 text-center',
                        wrapperSortable && 'cursor-pointer hover:bg-surface-tertiary',
                        meta?.className,
                        header.column.getIsResizing() && 'bg-surface-tertiary/60',
                        isDesktopOnly && 'hidden md:table-cell',
                      )}
                      style={widthStyle}
                      onClick={
                        wrapperSortable ? header.column.getToggleSortingHandler() : undefined
                      }
                      onKeyDown={wrapperSortable ? handleSortingKeyDown : undefined}
                      role={wrapperSortable ? 'button' : undefined}
                      tabIndex={wrapperSortable ? 0 : undefined}
                      aria-label={sortAriaLabel}
                      aria-sort={ariaSort}
                    >
                      {isSelectHeader || hasCustomHeader ? (
                        flexRender(header.column.columnDef.header, header.getContext())
                      ) : (
                        <div className="flex items-center gap-1 md:gap-2">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {wrapperSortable && (
                            <span className="text-text-primary" aria-hidden="true">
                              {{
                                asc: <ArrowUp className="size-4 text-text-primary" />,
                                desc: <ArrowDown className="size-4 text-text-primary" />,
                              }[header.column.getIsSorted() as string] ?? (
                                <ArrowDownUp className="size-4 text-text-primary" />
                              )}
                            </span>
                          )}
                        </div>
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>

          <TableBody>
            {tableBodyContent}
            {isFetchingNextPage && (
              <TableRow>
                <TableCell
                  colSpan={tableColumns.length}
                  className="p-4 text-center"
                  id="loading-status"
                  role="status"
                  aria-live="polite"
                >
                  <div className="flex items-center justify-center gap-2">
                    <Spinner className="h-5 w-5" aria-hidden="true" />
                    <span className="sr-only">{localize('com_ui_loading_more_data')}</span>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        {!isLoading && !showSkeletons && rows.length === 0 && (
          <div
            className="flex flex-col items-center justify-center py-12"
            role="status"
            aria-live="polite"
          >
            <Label className="text-center text-text-secondary">
              {searchTerm ? localize('com_ui_no_search_results') : localize('com_ui_no_data')}
            </Label>
          </div>
        )}
      </div>
      {paginationActive && (
        <div
          className="flex w-full shrink-0 items-center justify-end gap-2 border-t border-border-light px-2 py-2 md:px-3"
          role="navigation"
          aria-label={localize('com_ui_pagination')}
        >
          <div className="mr-auto text-xs text-text-secondary md:text-sm" aria-live="polite">
            {`${pagination.pageIndex + 1} / ${Math.max(table.getPageCount(), 1)}`}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            aria-label={localize('com_ui_prev')}
          >
            {localize('com_ui_prev')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            aria-label={localize('com_ui_next')}
          >
            {localize('com_ui_next')}
          </Button>
        </div>
      )}
    </div>
  );
}

export default DataTable;
