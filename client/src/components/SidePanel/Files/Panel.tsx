import { useCallback, useMemo, useRef, useState } from 'react';
import { ArrowUpLeft, Upload } from 'lucide-react';
import { v4 } from 'uuid';
import { Spinner, useToastContext, Button, DataTable } from '@librechat/client';
import type { DataTableConfig } from '@librechat/client';
import type { TFile } from 'librechat-data-provider';
import FilePreviewDialog from '~/components/Chat/Messages/Content/FilePreviewDialog';
import { MyFilesModal } from '~/components/Chat/Input/Files/MyFilesModal';
import { useLocalize, useAttachFileToChat } from '~/hooks';
import { useGetFiles, useUploadFileMutation } from '~/data-provider';
import { useChatContext } from '~/Providers/ChatContext';
import { buildColumns } from './PanelColumns';

const TABLE_CONFIG: DataTableConfig = {
  selection: { enableRowSelection: false, showCheckboxes: false },
  behavior: {
    manualSorting: false,
    manualFiltering: false,
    enablePagination: true,
    pageSize: 6,
  },
  search: { filterColumn: 'filename' },
};

interface PendingUpload {
  file_id: string;
  filename: string;
}

export default function FilesPanel({ onClose }: { onClose?: () => void }) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { conversation } = useChatContext();
  const { data: filesList = [] } = useGetFiles<TFile[]>();

  const [showFilesModal, setShowFilesModal] = useState(false);
  const [previewFile, setPreviewFile] = useState<TFile | null>(null);
  /**
   * In-flight uploads — tracked locally because the global file query
   * cache only receives a row once the mutation resolves. Without this,
   * the user clicks Upload and nothing visible happens until the file
   * appears in the list (or never, on error).
   */
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const manageFilesRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const removePending = useCallback((file_id: string) => {
    setPendingUploads((prev) => prev.filter((p) => p.file_id !== file_id));
  }, []);

  const uploadFileMutation = useUploadFileMutation({
    onError: () => {
      showToast({ message: localize('com_error_files_upload'), status: 'error' });
    },
  });

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files?.length) {
        return;
      }

      const endpoint = conversation?.endpoint ?? 'default';
      const newPending: PendingUpload[] = [];

      for (const file of Array.from(files)) {
        const file_id = v4();
        const formData = new FormData();
        formData.append('endpoint', endpoint);
        formData.append('file', file, encodeURIComponent(file.name));
        formData.append('file_id', file_id);
        formData.append('message_file', 'true');
        newPending.push({ file_id, filename: file.name });
        uploadFileMutation.mutate(formData, {
          onSettled: () => removePending(file_id),
        });
      }

      setPendingUploads((prev) => [...newPending, ...prev]);
      e.target.value = '';
    },
    [conversation?.endpoint, removePending, uploadFileMutation],
  );

  /**
   * Hide pending entries whose file_id has already landed in the global
   * files cache. `useUploadFileMutation.onSuccess` writes to the cache
   * before our `onSettled` removes the pending entry — without this
   * dedup the same file could flicker in both the indicator and the
   * table for a single render tick. `Set` lookup keeps the per-render
   * cost O(n) over `filesList`. */
  const visiblePending = useMemo(() => {
    if (pendingUploads.length === 0) {
      return pendingUploads;
    }
    const knownIds = new Set(filesList.map((f) => f.file_id));
    return pendingUploads.filter((p) => !knownIds.has(p.file_id));
  }, [pendingUploads, filesList]);

  const isUploading = visiblePending.length > 0;
  const uploadStatusLabel = useMemo(() => {
    if (visiblePending.length === 0) {
      return '';
    }
    if (visiblePending.length === 1) {
      return localize('com_ui_uploading_file', { 0: visiblePending[0].filename });
    }
    return localize('com_ui_uploading_files_count', { 0: String(visiblePending.length) });
  }, [localize, visiblePending]);

  return (
    <div className="flex h-full w-full flex-col gap-2 px-3 pb-3 pt-2">
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
      <DataTable
        columns={columns}
        data={filesWithIds}
        config={TABLE_CONFIG}
        onRowClick={(row) => handlePreview(row as TFile)}
        className="h-auto max-h-[calc(100vh-16rem)] flex-1"
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileUpload}
      />
      <div className="flex w-full gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() => fileInputRef.current?.click()}
          aria-label={localize('com_ui_upload_files')}
          disabled={isUploading}
        >
          {isUploading ? (
            <Spinner className="h-4 w-4" size={16} />
          ) : (
            <Upload className="h-4 w-4" aria-hidden="true" />
          )}
          <span className="ml-2">{localize('com_ui_upload')}</span>
        </Button>
        <Button
          ref={manageFilesRef}
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() => setShowFilesModal(true)}
          aria-label={localize('com_sidepanel_manage_files')}
        >
          <ArrowUpLeft className="h-4 w-4" aria-hidden="true" />
          <span className="ml-2">{localize('com_sidepanel_manage_files')}</span>
        </Button>
      </div>
      <MyFilesModal
        open={showFilesModal}
        onOpenChange={setShowFilesModal}
        triggerRef={manageFilesRef}
        onAttachSuccess={onClose}
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
