import { useCallback, useMemo, useRef, useState } from 'react';
import { ArrowUpLeft } from 'lucide-react';
import { Button, DataTable, useToastContext } from '@librechat/client';
import {
  megabyte,
  mergeFileConfig,
  checkOpenAIStorage,
  isAssistantsEndpoint,
  getEndpointFileConfig,
  fileConfig as defaultFileConfig,
} from 'librechat-data-provider';
import type { DataTableConfig } from '@librechat/client';
import type { TFile } from 'librechat-data-provider';
import FilePreviewDialog from '~/components/Chat/Messages/Content/FilePreviewDialog';
import { MyFilesModal } from '~/components/Chat/Input/Files/MyFilesModal';
import { useFileMapContext, useChatContext } from '~/Providers';
import { useLocalize, useUpdateFiles } from '~/hooks';
import { useGetFiles, useGetFileConfig } from '~/data-provider';
import { buildColumns } from './PanelColumns';

const TABLE_CONFIG: DataTableConfig = {
  selection: { enableRowSelection: false, showCheckboxes: false },
  behavior: {
    manualSorting: false,
    manualFiltering: false,
    enablePagination: true,
    pageSize: 10,
  },
  search: { filterColumn: 'filename' },
};

export default function FilesPanel() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const fileMap = useFileMapContext();
  const { files, setFiles, conversation } = useChatContext();
  const { addFile } = useUpdateFiles(setFiles);
  const { data: filesList = [] } = useGetFiles<TFile[]>();
  const { data: fileConfig = null } = useGetFileConfig({
    select: (data) => mergeFileConfig(data),
  });

  const [showFilesModal, setShowFilesModal] = useState(false);
  const [previewFile, setPreviewFile] = useState<TFile | null>(null);
  const manageFilesRef = useRef<HTMLButtonElement>(null);

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

  const columns = useMemo(() => buildColumns({ onPreview: handlePreview }), [handlePreview]);

  const handleFileClick = useCallback(
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

      if (endpointFileConfig.fileLimit && files.size >= endpointFileConfig.fileLimit) {
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
        const existing = files.get(fileData.file_id);
        let currentTotalSize = 0;
        for (const f of files.values()) {
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
    },
    [addFile, files, fileMap, conversation, localize, showToast, fileConfig],
  );

  return (
    <div className="flex h-full w-full flex-col gap-2 px-3 pb-3 pt-2">
      <DataTable
        columns={columns}
        data={filesWithIds}
        config={TABLE_CONFIG}
        onRowClick={(row) => handleFileClick(row as TFile)}
        className="h-auto max-h-[calc(100vh-12rem)] flex-1"
      />
      <Button
        ref={manageFilesRef}
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => setShowFilesModal(true)}
        aria-label={localize('com_sidepanel_manage_files')}
      >
        <ArrowUpLeft className="h-4 w-4" aria-hidden="true" />
        <span className="ml-2">{localize('com_sidepanel_manage_files')}</span>
      </Button>
      <MyFilesModal
        open={showFilesModal}
        onOpenChange={setShowFilesModal}
        triggerRef={manageFilesRef}
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
