import type { ColumnDef, SortingState, Table } from '@tanstack/react-table';
import type { TranslationKeys } from '../../hooks';
import type React from 'react';

export type TableColumn<TData, TValue> = ColumnDef<TData, TValue> & {
  accessorKey?: string | number;
  meta?: {
    /**
     * Column width as a percentage of total table width (1-100).
     *
     * Use this for proportional sizing. For columns that should be a fixed
     * pixel width, omit `width` and rely on `minWidth` plus content sizing.
     *
     * For responsive widths (different on mobile vs desktop), compute the
     * value in your column definition's `useMemo` based on `useMediaQuery`.
     */
    width?: number;
    /** Minimum width for the column (e.g., '80px'). */
    minWidth?: string | number;
    /** Additional CSS classes to apply to the column cells and header. */
    className?: string;
    /**
     * When true, this column will be hidden on mobile devices (viewport < 768px).
     * This is useful for hiding less critical information on smaller screens.
     *
     * **Usage Example:**
     * ```typescript
     * {
     *   accessorKey: 'createdAt',
     *   header: 'Date Created',
     *   cell: ({ row }) => formatDate(row.original.createdAt),
     *   meta: {
     *     desktopOnly: true,  // Hide this column on mobile
     *     width: 20,
     *     className: 'min-w-[6rem]'
     *   }
     * }
     * ```
     *
     * The column will be completely hidden including:
     * - Header cell
     * - Data cells
     * - Skeleton loading cells
     */
    desktopOnly?: boolean;
    /**
     * When true, this column's cells will use `<th scope="row">` instead of `<td>`.
     * This is important for accessibility as it marks the cell as a row header,
     * providing context for screen readers about what each row represents.
     *
     * Typically the first column (e.g., name, title) should be marked as a row header.
     *
     * **Usage Example:**
     * ```typescript
     * {
     *   accessorKey: 'title',
     *   header: 'Conversation Name',
     *   cell: ({ row }) => row.original.title,
     *   meta: {
     *     isRowHeader: true  // Mark this column as row headers
     *   }
     * }
     * ```
     */
    isRowHeader?: boolean;
    /**
     * When true, the wrapping `<th>` will NOT attach a click-to-sort handler
     * or render the default sort indicator chevron. Use this when the column's
     * `header` function renders its own interactive sort control
     * (e.g. `SortFilterHeader`, a custom `<Button>`), so that:
     *   - clicks on the inner control are not double-handled by the wrapper
     *   - only one sort indicator is visible
     *
     * Defaults to `false` — the wrapper behaves as a sortable cell when the
     * column allows sorting.
     */
    customHeader?: boolean;
  };
};

export interface DataTableConfig {
  /**
   * Row selection / multi-select checkboxes.
   *
   * - `enableRowSelection` (default: `true`) — gates react-table's selection state.
   *   When `false`, all selection APIs become no-ops.
   * - `showCheckboxes` (default: `true`) — renders the checkbox column.
   *   Set to `false` for read-only / "view-only" tables (e.g. side-panel
   *   listings where rows act as buttons).
   */
  selection?: {
    enableRowSelection?: boolean;
    showCheckboxes?: boolean;
  };
  /**
   * Search/filter input behaviour.
   *
   * - `enableSearch` (default: `true`) — shows the search box in the toolbar.
   * - `debounce` (default: `300` ms) — input debounce before firing the change.
   * - `filterColumn` — when set + `behavior.manualFiltering: false`, the
   *   search box drives client-side filtering of that column. Required
   *   pairing for client-side search; ignored when `onFilterChange` is
   *   provided (server-side mode).
   */
  search?: {
    enableSearch?: boolean;
    debounce?: number;
    filterColumn?: string;
  };
  /**
   * Skeleton placeholder rows shown while `isLoading` or `isFetching` (not
   * appending) is true.
   *
   * - `count` (default: `10`) — number of skeleton rows.
   */
  skeleton?: {
    count?: number;
  };
  /**
   * Row virtualization (via `@tanstack/react-virtual`). Only active when
   * `behavior.enablePagination` is `false` AND `data.length >= minRows`.
   *
   * - `overscan` (default: `10`) — rows rendered above/below viewport.
   * - `minRows` (default: `50`) — minimum data length before virtualizing.
   * - `rowHeight` (default: `56`) — estimated row height in pixels.
   * - `fastOverscanMultiplier` (default: `4`) — overscan boost during fast
   *   scrolling (capped at `overscan * 8`).
   */
  virtualization?: {
    overscan?: number;
    minRows?: number;
    rowHeight?: number;
    fastOverscanMultiplier?: number;
  };
  /**
   * Reserved for future column pinning support.
   * Currently unused.
   */
  pinning?: {
    enableColumnPinning?: boolean;
  };
  /**
   * Override default data orchestration. By default the table operates in
   * **server-side mode** (manual sort/filter, infinite scroll via virtualizer).
   *
   * - `manualSorting` (default: `true`) — server sorts; consumer updates
   *   `queryParams.sortBy/sortDirection` via `onSortingChange`.
   *   Set `false` for client-side sorting (uses `getSortedRowModel`).
   * - `manualFiltering` (default: `true`) — server filters; consumer updates
   *   `queryParams.search` via `onFilterChange`.
   *   Set `false` to enable client-side filter via `search.filterColumn`.
   * - `enablePagination` (default: `false`) — disables virtualization and
   *   switches to standard Prev/Next pagination controls.
   * - `pageSize` (default: `10`) — rows per page when pagination is active.
   *
   * **Typical pairings:**
   *
   * ```ts
   * // Server-side (default): big lists, cursor pagination
   * config={{ /* nothing — defaults are correct *​/ }}
   *
   * // Client-side: small/medium dataset already in memory
   * config={{ behavior: { manualSorting: false, manualFiltering: false, enablePagination: true, pageSize: 10 } }}
   * ```
   */
  behavior?: {
    manualSorting?: boolean;
    manualFiltering?: boolean;
    enablePagination?: boolean;
    pageSize?: number;
  };
  /**
   * Render a column-visibility dropdown in the toolbar so users can
   * hide/show columns.
   *
   * - `enabled` (default: `false`) — show the dropdown trigger.
   * - `contextMap` (required when enabled) — maps each `column.id` /
   *   `accessorKey` to a translation key for the dropdown label.
   *
   * ```ts
   * config={{
   *   columnVisibility: {
   *     enabled: true,
   *     contextMap: { filename: 'com_ui_name', updatedAt: 'com_ui_date' },
   *   },
   * }}
   * ```
   */
  columnVisibility?: {
    enabled?: boolean;
    contextMap?: Record<string, TranslationKeys>;
  };
}

/**
 * Minimum shape DataTable requires from each row: a stable `id` used by
 * react-table for selection / virtualization keying. Strings preferred
 * (database primary keys); numbers accepted for synthetic IDs.
 *
 * Consumers whose source data lacks an `id` field (e.g. `conversationId`,
 * `shareId`, `file_id`) should map it into shape before passing:
 *
 * ```ts
 * const rows = useMemo(() => items.map((it) => ({ ...it, id: it.shareId })), [items]);
 * ```
 *
 * Making this explicit at the type level prevents the silent fall-back to
 * index-based row IDs, which breaks selection state when data reorders.
 */
export interface RowWithId {
  id: string | number;
}

/**
 * Utility: take any data shape `T` and add the required `id` field.
 *
 * Use at the call site when the source type lacks an `id` (e.g. uses
 * `file_id`, `shareId`, `conversationId`) — declare your columns and your
 * mapped data as `WithId<TFile>` / `WithId<SharedLinkItem>` etc. so the
 * `TData` generic is consistently inferred for both `columns` and `data`
 * props of `DataTable`.
 */
export type WithId<T> = T & RowWithId;

export interface DataTableProps<TData extends RowWithId, TValue> {
  columns: TableColumn<TData, TValue>[];
  data: TData[];
  className?: string;
  isLoading?: boolean;
  isFetching?: boolean;
  config?: DataTableConfig;
  onDelete?: (selectedRows: TData[]) => Promise<void>;
  filterValue?: string;
  onFilterChange?: (value: string) => void;
  defaultSort?: SortingState;
  isFetchingNextPage?: boolean;
  hasNextPage?: boolean;
  fetchNextPage?: () => Promise<unknown>;
  sorting?: SortingState;
  onSortingChange?: (updater: SortingState | ((old: SortingState) => SortingState)) => void;
  conversationIndex?: number;
  customActionsRenderer?: (params: {
    selectedCount: number;
    selectedRows: TData[];
    table: Table<TData>;
  }) => React.ReactNode;
  /**
   * Invoked when a body row is activated via click or keyboard (Enter/Space).
   * Clicks that originate from interactive children (links, buttons, inputs,
   * checkboxes, or elements marked `data-row-action`) are ignored.
   */
  onRowClick?: (row: TData) => void;
}

export interface DataTableSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}
