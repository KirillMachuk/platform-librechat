import { useCallback, useMemo, useState } from 'react';
import { Upload } from 'lucide-react';
import { useSetRecoilState } from 'recoil';
import { FileSources, FileContext } from 'librechat-data-provider';
import {
  Button,
  Spinner,
  DataTable,
  OGDialog,
  TrashIcon,
  OGDialogTitle,
  OGDialogHeader,
  OGDialogContent,
} from '@librechat/client';
import type { DataTableConfig } from '@librechat/client';
import type { TFile } from 'librechat-data-provider';
import { useAttachFileToChat, useDeleteFilesFromTable, useLibraryUpload } from '~/hooks/Files';
import FilePreviewDialog from '~/components/Chat/Messages/Content/FilePreviewDialog';
import { buildColumns, filenameContextMap } from './Table/Columns';
import { useGetFiles } from '~/data-provider';
import { useLocalize } from '~/hooks';
import store from '~/store';

export function MyFilesModal({
  open,
  onOpenChange,
  triggerRef,
  onAttachSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef?: React.RefObject<HTMLButtonElement | HTMLDivElement | null>;
  onAttachSuccess?: () => void;
}) {
  const localize = useLocalize();
  const [previewFile, setPreviewFile] = useState<TFile | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const setSelectedFiles = useSetRecoilState(store.filesByIndex(0));
  const { deleteFiles } = useDeleteFilesFromTable(() => setIsDeleting(false));
  const {
    fileInputRef,
    handleFileUpload,
    isUploading,
    uploadStatusLabel,
    dropHandlers,
    isDragActive,
  } = useLibraryUpload();

  const { data: files = [] } = useGetFiles<TFile[]>({
    select: (files) =>
      files.map((file) => {
        file.context = file.context ?? FileContext.unknown;
        file.filterSource = file.source === FileSources.firebase ? FileSources.local : file.source;
        return file;
      }),
  });

  const filesWithIds = useMemo<Array<TFile & { id: string }>>(
    () => files.map((file) => ({ ...file, id: file.file_id })),
    [files],
  );

  const handlePreview = useCallback((file: TFile) => setPreviewFile(file), []);
  const handlePreviewClose = useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      setPreviewFile(null);
    }
  }, []);

  const columns = useMemo(() => buildColumns({ onPreview: handlePreview }), [handlePreview]);

  const closeModal = useCallback(() => {
    onOpenChange(false);
    onAttachSuccess?.();
  }, [onOpenChange, onAttachSuccess]);
  const attachFile = useAttachFileToChat(closeModal);

  const config = useMemo<DataTableConfig>(
    () => ({
      behavior: {
        manualSorting: false,
        manualFiltering: false,
        enablePagination: true,
        pageSize: 10,
      },
      search: { filterColumn: 'filename' },
      columnVisibility: { enabled: true, contextMap: filenameContextMap },
    }),
    [],
  );

  return (
    <>
      <OGDialog open={open} onOpenChange={onOpenChange} triggerRef={triggerRef}>
        <OGDialogContent
          title={localize('com_nav_my_files')}
          className="w-11/12 bg-background text-text-primary shadow-2xl"
          {...dropHandlers}
        >
          {isDragActive && (
            <div
              className="bg-surface-primary/90 pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-xl border-2 border-dashed border-border-heavy"
              role="status"
              aria-live="polite"
            >
              <div className="flex items-center gap-2 text-base font-medium text-text-primary">
                <Upload className="size-5" aria-hidden="true" />
                {localize('com_ui_library_drop_here')}
              </div>
            </div>
          )}
          <OGDialogHeader>
            <OGDialogTitle>{localize('com_nav_my_files')}</OGDialogTitle>
          </OGDialogHeader>
          {isUploading && (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-2 rounded-md border border-border-light bg-surface-secondary px-2 py-1.5 text-xs text-text-secondary"
            >
              <Spinner className="size-3 shrink-0" size={12} />
              <span className="shimmer min-w-0 flex-1 truncate">{uploadStatusLabel}</span>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            tabIndex={-1}
            aria-hidden="true"
            className="hidden"
            onChange={handleFileUpload}
          />
          <DataTable
            columns={columns}
            data={filesWithIds}
            config={config}
            onRowClick={(row) => attachFile(row as TFile)}
            customActionsRenderer={({ selectedRows }) => (
              <>
                <Button
                  variant="outline"
                  disabled={isUploading}
                  onClick={() => fileInputRef.current?.click()}
                  className="ml-2"
                  aria-label={localize('com_ui_upload_files')}
                >
                  {isUploading ? (
                    <Spinner className="size-4" />
                  ) : (
                    <Upload className="size-4" aria-hidden="true" />
                  )}
                  <span className="ml-2 hidden sm:inline">{localize('com_ui_upload')}</span>
                </Button>
                <Button
                  variant="outline"
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
                    <TrashIcon className="size-4 text-red-400" />
                  )}
                  <span className="ml-2 hidden sm:inline">{localize('com_ui_delete')}</span>
                </Button>
              </>
            )}
          />
        </OGDialogContent>
      </OGDialog>
      <FilePreviewDialog
        open={previewFile !== null}
        onOpenChange={handlePreviewClose}
        fileName={previewFile?.filename ?? ''}
        fileId={previewFile?.file_id}
        fileType={previewFile?.type ?? undefined}
        fileSize={previewFile?.bytes}
      />
    </>
  );
}
