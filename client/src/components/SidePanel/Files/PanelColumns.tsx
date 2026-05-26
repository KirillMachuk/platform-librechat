/* eslint-disable react-hooks/rules-of-hooks */
import { Eye } from 'lucide-react';
import type { TableColumn } from '@librechat/client';
import type { TFile } from 'librechat-data-provider';
import PanelFileCell from './PanelFileCell';
import { useLocalize } from '~/hooks';
import { formatDate } from '~/utils';

export interface PanelColumnsContext {
  onPreview: (file: TFile) => void;
}

export const buildColumns = (ctx: PanelColumnsContext): TableColumn<TFile, unknown>[] => [
  {
    accessorKey: 'filename',
    header: () => {
      const localize = useLocalize();
      return localize('com_ui_name');
    },
    cell: ({ row }) => <PanelFileCell file={row.original} />,
    meta: {
      width: 65,
      isRowHeader: true,
    },
  },
  {
    accessorKey: 'updatedAt',
    header: () => {
      const localize = useLocalize();
      return localize('com_ui_date');
    },
    cell: ({ row }) => (
      <span className="flex justify-end text-xs">
        {formatDate(row.original?.updatedAt?.toString() ?? '')}
      </span>
    ),
    meta: {
      width: 25,
    },
  },
  {
    id: 'actions',
    header: () => null,
    cell: ({ row }) => {
      const localize = useLocalize();
      const label = `${localize('com_ui_preview')}: ${row.original.filename}`;
      return (
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              ctx.onPreview(row.original);
            }}
            aria-label={label}
            title={localize('com_ui_preview')}
            className="rounded p-1 text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-heavy"
          >
            <Eye className="size-4" aria-hidden="true" />
          </button>
        </div>
      );
    },
    meta: {
      width: 10,
    },
  },
];

export const columns = buildColumns({
  onPreview: () => {
    /* Stable no-op fallback for any consumer that imports `columns` directly
     * — production callers should use `buildColumns({ onPreview })` so the
     * action wires into a real handler. */
  },
});
