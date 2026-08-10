import { useCallback, useMemo, useState } from 'react';
import { useSetRecoilState } from 'recoil';
import { Spinner, Button, DataTable } from '@librechat/client';
import type { DataTableConfig } from '@librechat/client';
import type { TFile } from 'librechat-data-provider';
import { useAttachFileToChat, useDeleteFilesFromTable, useLibraryUpload } from '~/hooks/Files';
import FilePreviewDialog from '~/components/Chat/Messages/Content/FilePreviewDialog';
import { buildColumns, filenameContextMap } from './columns';
import { Upload, Trash2 } from '~/components/icons';
import { useGetFiles } from '~/data-provider';
import { useLocalize } from '~/hooks';
import store from '~/store';

/**
 * The file library, and there is one of it.
 *
 * There used to be two, nested: this panel showed a cut-down table — name and
 * date, no way to select anything — under a button that opened a second dialog
 * with the same files, the columns that matter, checkboxes and a delete. So a
 * person opened Files, got the short list, and had to guess that another button
 * led to the real one. Nothing else opened that second dialog; it existed only
 * to be reached from here.
 *
 * The short list is gone and this one carries everything, including the index
 * column the prototype calls the important one: whether the assistant can find
 * the document yet.
 */
const TABLE_CONFIG: DataTableConfig = {
  behavior: {
    manualSorting: false,
    manualFiltering: false,
    enablePagination: true,
    pageSize: 10,
  },
  search: { filterColumn: 'filename' },
  columnVisibility: { enabled: true, contextMap: filenameContextMap },
};

export default function FilesPanel({ onClose }: { onClose?: () => void }) {
  const localize = useLocalize();
  const [isDeleting, setIsDeleting] = useState(false);
  const [previewFile, setPreviewFile] = useState<TFile | null>(null);
  const setSelectedFiles = useSetRecoilState(store.filesByIndex(0));
  const { deleteFiles } = useDeleteFilesFromTable(() => setIsDeleting(false));
  const { openFilePicker, isUploading, uploadStatusLabel, dropHandlers, isDragActive } =
    useLibraryUpload();

  const { data: filesList = [] } = useGetFiles<TFile[]>();

  const filesWithIds = useMemo<Array<TFile & { id: string }>>(
    () => filesList.map((file) => ({ ...file, id: file.file_id })),
    [filesList],
  );

  const handlePreview = useCallback((file: TFile) => setPreviewFile(file), []);
  const handlePreviewClose = useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      setPreviewFile(null);
    }
  }, []);

  const attachFile = useAttachFileToChat(onClose);
  const columns = useMemo(() => buildColumns({ onAttach: attachFile }), [attachFile]);

  return (
    <div className="relative flex h-full w-full flex-col gap-2 px-3 pb-3 pt-2" {...dropHandlers}>
      {isDragActive && (
        <div
          className="bg-surface-primary/90 pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-lg border-2 border-dashed border-border-heavy"
          role="status"
          aria-live="polite"
        >
          <span className="px-4 text-center text-sm font-medium text-text-primary">
            {localize('com_ui_library_drop_here')}
          </span>
        </div>
      )}
      {isUploading && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 rounded-xl border border-border-light bg-surface-secondary px-2 py-1.5 text-xs text-text-secondary"
        >
          <Spinner className="size-3 shrink-0" size={12} />
          <span className="shimmer min-w-0 flex-1 truncate">{uploadStatusLabel}</span>
        </div>
      )}
      <DataTable
        columns={columns}
        data={filesWithIds}
        config={TABLE_CONFIG}
        onRowClick={(row) => handlePreview(row as TFile)}
        className="h-auto max-h-[calc(100vh-16rem)] flex-1"
        customActionsRenderer={({ selectedRows }) => (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={isUploading}
              onClick={openFilePicker}
              className="ml-2"
              aria-label={localize('com_ui_upload_files')}
            >
              {isUploading ? (
                <Spinner className="size-4" />
              ) : (
                <Upload className="icon-sm" aria-hidden="true" />
              )}
              <span className="ml-2 hidden sm:inline">{localize('com_ui_upload')}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={selectedRows.length === 0 || isDeleting}
              onClick={() => {
                setIsDeleting(true);
                deleteFiles({ files: selectedRows as TFile[], setFiles: setSelectedFiles });
              }}
              className="ml-2"
              aria-label={localize('com_ui_delete')}
            >
              {isDeleting ? (
                <Spinner className="size-4" />
              ) : (
                <Trash2 className="icon-sm text-text-destructive" aria-hidden="true" />
              )}
              <span className="ml-2 hidden sm:inline">{localize('com_ui_delete')}</span>
            </Button>
          </>
        )}
      />
      <FilePreviewDialog
        open={previewFile !== null}
        onOpenChange={handlePreviewClose}
        fileName={previewFile?.filename ?? ''}
        fileId={previewFile?.file_id}
        fileType={previewFile?.type ?? undefined}
        fileSize={previewFile?.bytes}
      />
    </div>
  );
}
