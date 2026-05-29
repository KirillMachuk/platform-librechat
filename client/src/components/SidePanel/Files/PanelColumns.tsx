/* eslint-disable react-hooks/rules-of-hooks */
import { Paperclip } from 'lucide-react';
import type { TableColumn } from '@librechat/client';
import type { TFile } from 'librechat-data-provider';
import PanelFileCell from './PanelFileCell';
import { useLocalize } from '~/hooks';
import { formatDate } from '~/utils';

export type TFileRow = TFile & { id: string };

export interface PanelColumnsContext {
  onAttach: (file: TFile) => void;
}

export const buildColumns = (ctx: PanelColumnsContext): TableColumn<TFileRow, unknown>[] => [
  {
    accessorKey: 'filename',
    header: () => {
      const localize = useLocalize();
      return localize('com_ui_name');
    },
    cell: ({ row }) => <PanelFileCell row={row} />,
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
      const label = `${localize('com_ui_attach_to_chat')}: ${row.original.filename}`;
      return (
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              ctx.onAttach(row.original);
            }}
            aria-label={label}
            title={localize('com_ui_attach_to_chat')}
            className="rounded p-1 text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-heavy"
          >
            <Paperclip className="size-4" aria-hidden="true" />
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
  onAttach: () => {
    /* Stable no-op fallback for any consumer that imports `columns` directly
     * — production callers should use `buildColumns({ onAttach })` so the
     * action wires into a real handler. */
  },
});
