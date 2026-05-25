import type { ColumnDef, SortingState, Table } from '@tanstack/react-table';
import type { TranslationKeys } from '../../hooks';
import type React from 'react';

export type ProcessedDataRow<TData> = TData & { _id: string; _index: number };

export type TableColumnDef<TData, TValue> = ColumnDef<ProcessedDataRow<TData>, TValue>;

export type TableColumn<TData, TValue> = ColumnDef<TData, TValue> & {
  accessorKey?: string | number;
  meta?: {
    /** Column width as a percentage (1-100). Used for proportional column sizing. */
    width?: number;
    /** Fixed column size in pixels (e.g., '150px'). Takes precedence over width percentage. */
    size?: string | number;
    /** Fixed column size for mobile screens. Falls back to size if not specified. */
    mobileSize?: string | number;
    /** Minimum width for the column (e.g., '80px'). */
    minWidth?: string | number;
    /** Priority for flexible column width distribution. Higher priority = more space. Default is 1. */
    priority?: number;
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
  selection?: {
    enableRowSelection?: boolean;
    showCheckboxes?: boolean;
  };
  search?: {
    enableSearch?: boolean;
    debounce?: number;
    filterColumn?: string;
  };
  skeleton?: {
    count?: number;
  };
  virtualization?: {
    overscan?: number;
    minRows?: number;
    rowHeight?: number;
    fastOverscanMultiplier?: number;
  };
  pinning?: {
    enableColumnPinning?: boolean;
  };
  /**
   * Override default data orchestration. By default the table operates in
   * manual mode (server-side sort/filter with infinite scroll via virtualizer).
   * Set `manualSorting`/`manualFiltering` to `false` to enable client-side
   * sort/filter, and set `enablePagination` to swap virtualization for
   * standard prev/next pagination.
   */
  behavior?: {
    manualSorting?: boolean;
    manualFiltering?: boolean;
    enablePagination?: boolean;
    pageSize?: number;
  };
  /**
   * Render a column-visibility dropdown in the toolbar. Requires `contextMap`
   * to translate column ids into localized labels.
   */
  columnVisibility?: {
    enabled?: boolean;
    contextMap?: Record<string, TranslationKeys>;
  };
}

export interface DataTableProps<TData extends Record<string, unknown>, TValue> {
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
    table: Table<ProcessedDataRow<TData>>;
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
