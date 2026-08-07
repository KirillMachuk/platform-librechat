/* eslint-disable react-hooks/rules-of-hooks */
import { Paperclip } from 'lucide-react';
import { useMediaQuery } from '@librechat/client';
import type { TableColumn } from '@librechat/client';
import type { TFile } from 'librechat-data-provider';
import ImagePreview from '~/components/Chat/Input/Files/ImagePreview';
import FilePreview from '~/components/Chat/Input/Files/FilePreview';
import { TranslationKeys, useLocalize } from '~/hooks';
import { formatDate, getFileType } from '~/utils';

export type TFileRow = TFile & { id: string };

export interface FileColumnsContext {
  onAttach: (file: TFile) => void;
}

/**
 * The columns this library shows, in the order the prototype fixes them:
 * name, whether the assistant can find it, size, date.
 *
 * Storage (`local`/`openai`) and context (`message_attachment`) used to sit
 * here too. They are the words the code uses about itself, not what a person
 * came to find out, and at 720 they were what pushed Size off the edge.
 */
export const filenameContextMap: Record<string, TranslationKeys> = {
  filename: 'com_ui_name',
  embeddingStatus: 'com_ui_index_status',
  bytes: 'com_ui_size',
  updatedAt: 'com_ui_date',
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
    accessorKey: 'updatedAt',
    header: () => {
      const localize = useLocalize();
      return localize('com_ui_date');
    },
    cell: ({ row }) => {
      const isSmallScreen = useMediaQuery('(max-width: 768px)');
      /* formatDate reads the app language, and this cell renders separately from
         its header — without a subscription it keeps the previous language's date. */
      useLocalize();
      return formatDate(row.original.updatedAt?.toString() ?? '', isSmallScreen);
    },
    meta: { desktopOnly: true },
  },
  {
    id: 'attach',
    header: () => null,
    /**
     * Canon and the prototype split these two: the row opens a preview, this
     * button attaches the file to the chat you came from. The library used to
     * do it the other way round in one of its two copies — clicking a row
     * attached the file, and a separate eye opened it — which is the more
     * surprising of the two, because a row is the thing you click to look.
     */
    cell: ({ row }) => {
      const localize = useLocalize();
      const label = `${localize('com_sidepanel_attach_files')}: ${row.original.filename}`;
      return (
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              ctx.onAttach(row.original);
            }}
            aria-label={label}
            title={localize('com_sidepanel_attach_files')}
            className="tap-target flex size-8 items-center justify-center rounded-lg text-text-tertiary transition-colors duration-90 hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-heavy"
          >
            <Paperclip className="icon-sm" aria-hidden="true" />
          </button>
        </div>
      );
    },
    meta: {
      width: 8,
    },
  },
];
