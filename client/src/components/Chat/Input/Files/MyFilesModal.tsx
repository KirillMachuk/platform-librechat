import { useCallback, useMemo, useState } from 'react';
import { useSetRecoilState } from 'recoil';
import {
  megabyte,
  FileSources,
  FileContext,
  mergeFileConfig,
  checkOpenAIStorage,
  isAssistantsEndpoint,
  getEndpointFileConfig,
  fileConfig as defaultFileConfig,
} from 'librechat-data-provider';
import {
  Button,
  Spinner,
  DataTable,
  OGDialog,
  TrashIcon,
  OGDialogTitle,
  OGDialogHeader,
  OGDialogContent,
  useToastContext,
} from '@librechat/client';
import type { DataTableConfig } from '@librechat/client';
import type { TFile } from 'librechat-data-provider';
import FilePreviewDialog from '~/components/Chat/Messages/Content/FilePreviewDialog';
import { useFileMapContext, useChatContext } from '~/Providers';
import { buildColumns, filenameContextMap } from './Table/Columns';
import { useDeleteFilesFromTable } from '~/hooks/Files';
import { useLocalize, useUpdateFiles } from '~/hooks';
import { useGetFiles, useGetFileConfig } from '~/data-provider';
import store from '~/store';

export function MyFilesModal({
  open,
  onOpenChange,
  triggerRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef?: React.RefObject<HTMLButtonElement | HTMLDivElement | null>;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const fileMap = useFileMapContext();
  const { files: chatFiles, setFiles, conversation } = useChatContext();
  const { addFile } = useUpdateFiles(setFiles);
  const { data: fileConfig = null } = useGetFileConfig({
    select: (data) => mergeFileConfig(data),
  });

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

  const handleAttach = useCallback(
    (file: TFile) => {
      if (!fileMap?.[file.file_id] || !conversation?.endpoint) {
        showToast({ message: localize('com_ui_attach_error'), status: 'error' });
        return;
      }

      const fileData = fileMap[file.file_id];
      const endpoint = conversation.endpoint;
      const endpointType = conversation.endpointType;

      if (!fileData.source) {
        return;
      }

      const isOpenAIStorage = checkOpenAIStorage(fileData.source);
      const isAssistants = isAssistantsEndpoint(endpoint);

      if (isOpenAIStorage && !isAssistants) {
        showToast({ message: localize('com_ui_attach_error_openai'), status: 'error' });
        return;
      }

      if (!isOpenAIStorage && isAssistants) {
        showToast({ message: localize('com_ui_attach_warn_endpoint'), status: 'warning' });
      }

      const endpointFileConfig = getEndpointFileConfig({
        fileConfig,
        endpoint,
        endpointType,
      });

      if (endpointFileConfig.disabled === true) {
        showToast({ message: localize('com_ui_attach_error_disabled'), status: 'error' });
        return;
      }

      if (endpointFileConfig.fileLimit && chatFiles.size >= endpointFileConfig.fileLimit) {
        showToast({
          message: `${localize('com_ui_attach_error_limit')} ${endpointFileConfig.fileLimit} files (${endpoint})`,
          status: 'error',
        });
        return;
      }

      if (fileData.bytes >= (endpointFileConfig.fileSizeLimit ?? Number.MAX_SAFE_INTEGER)) {
        showToast({
          message: `${localize('com_ui_attach_error_size')} ${
            (endpointFileConfig.fileSizeLimit ?? 0) / megabyte
          } MB (${endpoint})`,
          status: 'error',
        });
        return;
      }

      if (!defaultFileConfig.checkType(file.type, endpointFileConfig.supportedMimeTypes ?? [])) {
        showToast({
          message: `${localize('com_ui_attach_error_type')} ${file.type} (${endpoint})`,
          status: 'error',
        });
        return;
      }

      if (endpointFileConfig.totalSizeLimit) {
        const existing = chatFiles.get(fileData.file_id);
        let currentTotalSize = 0;
        for (const f of chatFiles.values()) {
          currentTotalSize += f.size;
        }
        currentTotalSize -= existing?.size ?? 0;
        if (currentTotalSize + fileData.bytes > endpointFileConfig.totalSizeLimit) {
          showToast({
            message: `${localize('com_ui_attach_error_total_size')} ${endpointFileConfig.totalSizeLimit / megabyte} MB (${endpoint})`,
            status: 'error',
          });
          return;
        }
      }

      addFile({
        progress: 1,
        attached: true,
        file_id: fileData.file_id,
        filepath: fileData.filepath,
        preview: fileData.filepath,
        type: fileData.type,
        height: fileData.height,
        width: fileData.width,
        filename: fileData.filename,
        source: fileData.source,
        size: fileData.bytes,
        metadata: fileData.metadata,
      });

      onOpenChange(false);
    },
    [addFile, chatFiles, conversation, fileConfig, fileMap, localize, onOpenChange, showToast],
  );

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
            onRowClick={(row) => handleAttach(row as TFile)}
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
