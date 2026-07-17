import { useCallback, useMemo, useRef, useState } from 'react';
import { ArrowUpLeft, Upload } from 'lucide-react';
import { Spinner, Button, DataTable } from '@librechat/client';
import type { DataTableConfig } from '@librechat/client';
import type { TFile } from 'librechat-data-provider';
import FilePreviewDialog from '~/components/Chat/Messages/Content/FilePreviewDialog';
import { useLocalize, useAttachFileToChat, useLibraryUpload } from '~/hooks';
import { MyFilesModal } from '~/components/Chat/Input/Files/MyFilesModal';
import { useGetFiles } from '~/data-provider';
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

export default function FilesPanel({ onClose }: { onClose?: () => void }) {
  const localize = useLocalize();
  const { data: filesList = [] } = useGetFiles<TFile[]>();
  const {
    fileInputRef,
    handleFileUpload,
    isUploading,
    uploadStatusLabel,
    dropHandlers,
    isDragActive,
  } = useLibraryUpload();

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
        tabIndex={-1}
        aria-hidden="true"
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
