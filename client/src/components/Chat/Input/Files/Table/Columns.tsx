/* eslint-disable react-hooks/rules-of-hooks */
import { Database, Eye } from 'lucide-react';
import { FileSources, FileContext } from 'librechat-data-provider';
import {
  useMediaQuery,
  SortFilterHeader,
  AzureMinimalIcon,
  OpenAIMinimalIcon,
} from '@librechat/client';
import type { TableColumn } from '@librechat/client';
import type { TFile } from 'librechat-data-provider';
import ImagePreview from '~/components/Chat/Input/Files/ImagePreview';
import FilePreview from '~/components/Chat/Input/Files/FilePreview';
import { TranslationKeys, useLocalize } from '~/hooks';
import { formatDate, getFileType } from '~/utils';

export type TFileRow = TFile & { id: string };

export interface FileColumnsContext {
  onPreview: (file: TFile) => void;
}

const contextMap: Record<string, TranslationKeys> = {
  [FileContext.avatar]: 'com_ui_avatar',
  [FileContext.unknown]: 'com_ui_unknown',
  [FileContext.assistants]: 'com_ui_assistants',
  [FileContext.image_generation]: 'com_ui_image_gen',
  [FileContext.assistants_output]: 'com_ui_assistants_output',
  [FileContext.message_attachment]: 'com_ui_attachment',
};

export const filenameContextMap: Record<string, TranslationKeys> = {
  filename: 'com_ui_name',
  embeddingStatus: 'com_ui_index_status',
  updatedAt: 'com_ui_date',
  filterSource: 'com_ui_storage',
  context: 'com_ui_context',
  bytes: 'com_ui_size',
};

export const buildColumns = (ctx: FileColumnsContext): TableColumn<TFileRow, unknown>[] => [
  {
    accessorKey: 'filename',
    header: () => {
      const localize = useLocalize();
      return localize('com_ui_name');
    },
    cell: ({ row }) => {
      const file = row.original;
      if (file.type?.startsWith('image')) {
        return (
          <div className="flex gap-2">
            <ImagePreview
              url={file.filepath}
              className="relative h-10 w-10 shrink-0 overflow-visible rounded-md"
              source={file.source}
            />
            <span className="self-center truncate">{file.filename}</span>
          </div>
        );
      }

      const fileType = getFileType(file.type);
      return (
        <div className="flex gap-2">
          {fileType && <FilePreview fileType={fileType} className="relative" file={file} />}
          <span className="self-center truncate">{file.filename}</span>
        </div>
      );
    },
    meta: {
      isRowHeader: true,
    },
  },
  {
    accessorKey: 'embeddingStatus',
    header: () => {
      const localize = useLocalize();
      return localize('com_ui_index_status');
    },
    /* Search-index state so a file that is still embedding (or failed) is not
     * mistaken for one that library_search can already find. Ready is shown too
     * so the column reads clearly; files that are not indexed at all (images,
     * avatars) show a neutral dash.
     *
     * "Ready" means the assistant finds it ANYWHERE — so it requires the same
     * scope library_search uses (primeLibraryScope): project sources and
     * temporary-chat files are indexed under their own namespace and stay out of
     * the library, and a green "Ready" on them would promise a search that comes
     * back empty. */
    cell: ({ row }) => {
      const localize = useLocalize();
      const file = row.original;
      const status = file.embeddingStatus;
      if (status === 'pending' || status === 'processing') {
        return <span className="text-amber-600">{localize('com_ui_indexing')}</span>;
      }
      if (status === 'failed') {
        return <span className="text-red-500">{localize('com_ui_index_failed')}</span>;
      }
      if (file.embedded === true || status === 'ready') {
        const libraryWide = file.project_id == null && file.expiredAt == null;
        return libraryWide ? (
          <span className="text-green-600">{localize('com_ui_indexed')}</span>
        ) : (
          <span className="text-text-secondary">{localize('com_ui_indexed_scoped')}</span>
        );
      }
      return <span className="text-text-secondary">—</span>;
    },
  },
  {
    accessorKey: 'updatedAt',
    header: () => {
      const localize = useLocalize();
      return localize('com_ui_date');
    },
    cell: ({ row }) => {
      const isSmallScreen = useMediaQuery('(max-width: 768px)');
      return formatDate(row.original.updatedAt?.toString() ?? '', isSmallScreen);
    },
    meta: { desktopOnly: true },
  },
  {
    accessorKey: 'filterSource',
    meta: { customHeader: true, desktopOnly: true },
    header: ({ column }) => {
      const localize = useLocalize();
      return (
        <SortFilterHeader
          column={column}
          title={localize('com_ui_storage')}
          ariaLabel={localize('com_ui_storage_filter_sort')}
          filters={{
            Storage: Object.values(FileSources).filter(
              (value) =>
                value === FileSources.local ||
                value === FileSources.openai ||
                value === FileSources.azure,
            ),
          }}
          valueMap={{
            [FileSources.azure]: 'com_ui_azure',
            [FileSources.openai]: 'com_ui_openai',
            [FileSources.local]: 'com_ui_host',
          }}
        />
      );
    },
    cell: ({ row }) => {
      const localize = useLocalize();
      const { source } = row.original;
      if (source === FileSources.openai) {
        return (
          <div className="flex flex-wrap items-center gap-2">
            <OpenAIMinimalIcon className="icon-sm text-green-600/50" />
            {'OpenAI'}
          </div>
        );
      } else if (source === FileSources.azure) {
        return (
          <div className="flex flex-wrap items-center gap-2">
            <AzureMinimalIcon className="icon-sm text-cyan-700" />
            {'Azure'}
          </div>
        );
      }
      return (
        <div className="flex flex-wrap items-center gap-2">
          <Database className="icon-sm text-cyan-700" aria-hidden="true" />
          {localize('com_ui_host')}
        </div>
      );
    },
  },
  {
    accessorKey: 'context',
    meta: { customHeader: true, desktopOnly: true },
    header: ({ column }) => {
      const localize = useLocalize();
      return (
        <SortFilterHeader
          column={column}
          title={localize('com_ui_context')}
          ariaLabel={localize('com_ui_context_filter_sort')}
          filters={{
            Context: Object.values(FileContext).filter(
              (value) => value === FileContext[value ?? ''],
            ),
          }}
          valueMap={contextMap}
        />
      );
    },
    cell: ({ row }) => {
      const { context } = row.original;
      const localize = useLocalize();
      return (
        <div className="flex flex-wrap items-center gap-2">
          {localize(contextMap[context ?? FileContext.unknown])}
        </div>
      );
    },
  },
  {
    accessorKey: 'bytes',
    header: () => {
      const localize = useLocalize();
      return localize('com_ui_size');
    },
    cell: ({ row }) => {
      const value = Number((Number(row.original.bytes) / 1024 / 1024).toFixed(2));
      if (value < 0.01) {
        return '< 0.01 MB';
      }
      return `${value} MB`;
    },
    meta: { desktopOnly: true },
  },
  {
    id: 'preview',
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
      width: 8,
    },
  },
];

export const columns = buildColumns({
  onPreview: () => {
    /* Stable no-op fallback for any consumer importing `columns` directly —
     * production callers should use `buildColumns({ onPreview })` so the
     * action wires into a real handler. */
  },
});
