import { useCallback, useMemo, useState } from 'react';
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
import FilePreviewDialog from '~/components/Chat/Messages/Content/FilePreviewDialog';
import { buildColumns, filenameContextMap } from './Table/Columns';
import { useAttachFileToChat, useDeleteFilesFromTable } from '~/hooks/Files';
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
        >
          <OGDialogHeader>
            <OGDialogTitle>{localize('com_nav_my_files')}</OGDialogTitle>
          </OGDialogHeader>
          <DataTable
            columns={columns}
            data={filesWithIds}
            config={config}
            onRowClick={(row) => attachFile(row as TFile)}
            customActionsRenderer={({ selectedRows }) => (
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
