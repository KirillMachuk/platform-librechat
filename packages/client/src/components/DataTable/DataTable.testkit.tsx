import React, { useMemo, useRef } from 'react';
import { render } from '@testing-library/react';
import { Provider as JotaiProvider } from 'jotai';
import type { RenderOptions, RenderResult } from '@testing-library/react';
import type { DataTableProps, TableColumn } from './DataTable.types';
import DataTable from './DataTable';

/**
 * Test-only render-count probe. Wraps any subtree and throws a descriptive
 * error when the subtree re-renders more than `limit` times during a single
 * test. Converts jsdom's cryptic "Too many re-renders" into an actionable
 * signal that points at which test triggered the storm.
 *
 * Default limit (50) sits above the natural settling cost of a fresh
 * useVirtualizer + useReactTable mount (~2-5 renders) but below React's
 * internal 25/50 cap so we fail first with a clearer message.
 */
export interface RenderProbeProps {
  children: React.ReactNode;
  limit?: number;
  label?: string;
}

export function RenderProbe({ children, limit = 50, label = 'DataTable subtree' }: RenderProbeProps) {
  const count = useRef(0);
  count.current += 1;
  if (count.current > limit) {
    throw new Error(
      `${label} re-render storm: rendered ${count.current} times in a single test (limit=${limit}). ` +
        'This usually means a hook option or memo dependency is regenerated on every render. ' +
        'Common culprits: inline functions passed to useVirtualizer/useReactTable, ' +
        'unstable useLocalize/context identity, or columns/data refs constructed inside render.',
    );
  }
  return <>{children}</>;
}

export interface TestDataRow extends Record<string, unknown> {
  id: string;
  name: string;
  status: string;
  createdAt: string;
}

/** Build a stable-identity array of test rows. Call once per test. */
export const buildTestRows = (count: number): TestDataRow[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `row-${i}`,
    name: `Item ${i}`,
    status: i % 2 === 0 ? 'active' : 'inactive',
    createdAt: `2024-01-${String(i + 1).padStart(2, '0')}`,
  }));

/** Build a stable-identity array of test columns. Call once per test. */
export const buildTestColumns = (): TableColumn<TestDataRow, string>[] => [
  {
    accessorKey: 'name',
    header: 'Name',
    cell: ({ row }) => row.original.name,
    meta: { isRowHeader: true },
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => row.original.status,
  },
  {
    accessorKey: 'createdAt',
    header: 'Created At',
    cell: ({ row }) => row.original.createdAt,
    meta: { desktopOnly: true },
  },
];

export type RenderDataTableProps = Partial<DataTableProps<TestDataRow, string>> & {
  probeLimit?: number;
};

/**
 * Render helper that mirrors production usage of DataTable: memoises columns
 * and data at the wrapper level, wraps the subtree in JotaiProvider and the
 * RenderProbe. Prefer this over calling `render(<DataTable .../>)` directly
 * so future re-render regressions surface as named errors instead of jsdom's
 * cryptic loop guard.
 */
export function renderDataTable(
  props: RenderDataTableProps = {},
  options?: RenderOptions,
): RenderResult {
  const { columns, data, probeLimit, ...rest } = props;
  const Harness = () => {
    const memoColumns = useMemo(
      () => columns ?? buildTestColumns(),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    );
    const memoData = useMemo(
      () => data ?? buildTestRows(5),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    );
    return (
      <JotaiProvider>
        <RenderProbe limit={probeLimit ?? 50} label="DataTable">
          <DataTable<TestDataRow, string> {...rest} columns={memoColumns} data={memoData} />
        </RenderProbe>
      </JotaiProvider>
    );
  };
  return render(<Harness />, options);
}
