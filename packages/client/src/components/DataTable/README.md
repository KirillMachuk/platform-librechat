# DataTable

Single source of truth for tabular data in LibreChat. Wraps `@tanstack/react-table` with sticky/rounded styling, optional row virtualization, infinite scroll, client- or server-side sort/filter, pagination, column-visibility dropdown, row selection with checkboxes, keyboard-accessible row activation, and skeleton loading states.

If you're about to render a list of rows in `client/src/...`, **use this component**. Do not write a new one.

---

## Quick start

```tsx
import { useMemo } from 'react';
import { DataTable } from '@librechat/client';
import type { TableColumn, WithId } from '@librechat/client';

type Row = WithId<{ name: string; createdAt: string }>;

const columns: TableColumn<Row, unknown>[] = [
  { accessorKey: 'name', header: 'Name', meta: { isRowHeader: true } },
  { accessorKey: 'createdAt', header: 'Date' },
];

export function MyTable({ items }: { items: Array<{ id: string; name: string; createdAt: string }> }) {
  const data = useMemo<Row[]>(() => items, [items]);
  return <DataTable columns={columns} data={data} />;
}
```

**Two non-negotiable rules** that prevent the classic infinite-re-render bug:

1. **`columns` must be memoized** (`useMemo` or a module-level constant). A fresh `columns` reference every render destabilises the table's internal memos.
2. **Every row must have a unique `id`** (enforced by the `RowWithId` constraint on `TData`). If your source records use `file_id`, `shareId`, `conversationId`, etc., map them: `items.map((it) => ({ ...it, id: it.shareId }))` — wrapped in `useMemo`.

---

## Config API reference

All optional. Live in `DataTableConfig`. Defaults shown.

| Section | Field | Default | Purpose |
|---|---|---|---|
| `selection` | `enableRowSelection` | `true` | Allow row selection state. |
| | `showCheckboxes` | `true` | Render the checkbox column. `false` for read-only tables. |
| `search` | `enableSearch` | `true` | Show search box in toolbar. |
| | `debounce` | `300` | Input debounce (ms). |
| | `filterColumn` | — | Column id to filter client-side. Required for client-side search. |
| `skeleton` | `count` | `10` | Skeleton rows during loading. |
| `virtualization` | `overscan` | `10` | Rows rendered above/below viewport. |
| | `minRows` | `50` | Min data length before virtualizing. |
| | `rowHeight` | `56` | Estimated px height. |
| | `fastOverscanMultiplier` | `4` | Boost overscan during fast scroll. |
| `behavior` | `manualSorting` | `true` | `true` = server-side, `false` = client-side. |
| | `manualFiltering` | `true` | Same as above for filter. |
| | `enablePagination` | `false` | Swap virtualization for Prev/Next. |
| | `pageSize` | `10` | Rows per page (when pagination active). |
| `columnVisibility` | `enabled` | `false` | Show column-visibility dropdown. |
| | `contextMap` | — | Required if enabled. `Record<columnId, translationKey>`. |

Column-level `meta` (on each `TableColumn`):

| Field | Type | Purpose |
|---|---|---|
| `width` | `number` (1-100) | Column width as % of total table. |
| `minWidth` | `string \| number` | Min width (e.g. `'80px'`). |
| `className` | `string` | Extra CSS classes for header + cells. |
| `desktopOnly` | `boolean` | Hide column on viewport < 768px (CSS-based). |
| `isRowHeader` | `boolean` | Render as `<th scope="row">` for screen readers. Mark the "name" column. |
| `customHeader` | `boolean` | Opt out of the auto sort-on-click + auto sort indicator. Set when the column's `header` is itself an interactive control (e.g. `SortFilterHeader`). |

---

## Pattern: server-side data (infinite scroll)

When data is fetched in cursor-paginated chunks (e.g. via `useInfiniteQuery`). This is the default — no `config.behavior` overrides needed.

```tsx
const { data, hasNextPage, isFetchingNextPage, fetchNextPage, refetch } =
  useArchivedConvos(queryParams);

return (
  <DataTable
    columns={columns}
    data={rows}
    hasNextPage={hasNextPage}
    isFetchingNextPage={isFetchingNextPage}
    fetchNextPage={fetchNextPage}
    onFilterChange={(value) => setQueryParams((p) => ({ ...p, search: value }))}
    filterValue={queryParams.search}
    isLoading={isLoading}
    config={{ selection: { showCheckboxes: false } }}
  />
);
```

Reference: `client/src/components/Nav/SettingsTabs/General/ArchivedChatsTable.tsx`.

---

## Pattern: client-side data (pagination + sort/filter)

When the full dataset is already in memory (file lists, settings, etc).

```tsx
const config: DataTableConfig = {
  behavior: { manualSorting: false, manualFiltering: false, enablePagination: true, pageSize: 10 },
  search: { filterColumn: 'filename' },
  columnVisibility: { enabled: true, contextMap: { filename: 'com_ui_name', updatedAt: 'com_ui_date' } },
};

return <DataTable columns={columns} data={data} config={config} />;
```

Reference: `client/src/components/Chat/Input/Files/MyFilesModal.tsx`.

---

## Pattern: factory columns (action-handler injection)

Columns shouldn't reach across to import per-screen handlers. Use a `buildColumns(ctx)` factory so each screen wires its own actions, while the column shapes stay reusable.

```tsx
// Columns.tsx
export interface ColumnsContext { onPreview: (item: Item) => void; }

export const buildColumns = (ctx: ColumnsContext): TableColumn<Item, unknown>[] => [
  // ...
  {
    id: 'preview',
    cell: ({ row }) => (
      <button data-row-action onClick={() => ctx.onPreview(row.original)}>Preview</button>
    ),
  },
];

// MyTable.tsx
const handlePreview = useCallback((item: Item) => setPreview(item), []);
const columns = useMemo(() => buildColumns({ onPreview: handlePreview }), [handlePreview]);
```

Reference: `client/src/components/Chat/Input/Files/Table/Columns.tsx` + `MyFilesModal.tsx`.

---

## Pattern: row-click vs explicit actions

- **Primary action on the whole row** → `onRowClick`. Get accessibility for free (`role="button"`, keyboard Enter/Space, `INTERACTIVE_SELECTOR` shields child controls from bubbling).
- **Secondary actions on individual cells** → render `<button data-row-action>...</button>` inside a cell. The `data-row-action` attribute opts the click out of `onRowClick`.

```tsx
<DataTable
  columns={columns}
  data={data}
  onRowClick={(row) => handleAttach(row)}
/>
```

A row containing `<button>`, `<a>`, `<input>`, `<label>`, `<textarea>`, `<select>`, `[role="checkbox"]`, `[role="button"]`, `[role="menuitem"]`, or `[data-row-action]` is automatically guarded — child clicks don't fire `onRowClick`.

---

## Pattern: custom header

When a column needs its own interactive header (filter dropdown, multi-tier sort, etc), use `meta.customHeader: true` to disable the wrapper's auto sort handling. Otherwise clicks on the inner control are double-handled and you get two sort indicators.

```tsx
{
  accessorKey: 'filterSource',
  meta: { customHeader: true },
  header: ({ column }) => <SortFilterHeader column={column} title="Storage" filters={...} />,
}
```

Reference: `Chat/Input/Files/Table/Columns.tsx` (filterSource, context columns).

---

## Migration guide

Replacing a bespoke table with shared `DataTable`:

1. **Ensure `id`**: `data.map((d) => ({ ...d, id: d.<primaryKey> }))`, wrapped in `useMemo`.
2. **Convert columns** to `TableColumn<WithId<T>, unknown>[]`, memoize them.
3. **Pass `data` + `columns`** to `<DataTable />`.
4. **Move sort/filter UX** into `config.behavior` + `search.filterColumn` (client-side) or `onFilterChange` + `onSortingChange` (server-side).
5. **Move per-row actions** into column `cell` renderers, marking interactive children with `data-row-action`.
6. **Move bulk actions** into `customActionsRenderer` (gets `selectedCount`, `selectedRows`, `table`).
7. **Delete the bespoke table file** + any sub-components that no longer have callers.

---

## Files

| File | Role |
|---|---|
| `DataTable.tsx` | Main component. Handles state, virtualization, pagination, sort/filter orchestration. |
| `DataTable.types.ts` | Public types: `DataTableConfig`, `DataTableProps`, `TableColumn`, `RowWithId`, `WithId`. |
| `DataTable.hooks.ts` | `useDebounced`, `useOptimizedRowSelection`. |
| `DataTableComponents.tsx` | `MemoizedTableRow`, `SkeletonRows`, `SelectionCheckbox`. |
| `DataTableColumnVisibility.tsx` | Toolbar dropdown for hide/show columns. |
| `DataTableSearch.tsx` | Toolbar search input. |
| `SortFilterHeader.tsx` | Drop-in column header with sort + filter dropdown menu. |
| `DataTableErrorBoundary.tsx` | Optional error boundary wrapper. |
| `DataTable.spec.tsx` | Component tests. |
| `DataTable.hooks.spec.ts` | Hook tests. |
