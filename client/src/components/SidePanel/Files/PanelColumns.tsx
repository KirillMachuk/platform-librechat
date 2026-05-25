/* eslint-disable react-hooks/rules-of-hooks */
import type { TableColumn } from '@librechat/client';
import type { TFile } from 'librechat-data-provider';
import PanelFileCell from './PanelFileCell';
import { useLocalize } from '~/hooks';
import { formatDate } from '~/utils';

export const columns: TableColumn<TFile, unknown>[] = [
  {
    accessorKey: 'filename',
    header: () => {
      const localize = useLocalize();
      return localize('com_ui_name');
    },
    cell: ({ row }) => <PanelFileCell file={row.original} />,
    meta: {
      width: 75,
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
];
