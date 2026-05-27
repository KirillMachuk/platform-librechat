import { useCallback, useMemo, useRef, useState } from 'react';
import { ArrowUpLeft } from 'lucide-react';
import { Button, DataTable } from '@librechat/client';
import type { DataTableConfig } from '@librechat/client';
import type { TFile } from 'librechat-data-provider';
import FilePreviewDialog from '~/components/Chat/Messages/Content/FilePreviewDialog';
import { MyFilesModal } from '~/components/Chat/Input/Files/MyFilesModal';
import { useLocalize, useAttachFileToChat } from '~/hooks';
import { useGetFiles } from '~/data-provider';
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
  const { data: filesList = [] } = useGetFiles<TFile[]>();

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
  const attachFile = useAttachFileToChat();

  return (
    <div className="flex h-full w-full flex-col gap-2 px-3 pb-3 pt-2">
      <DataTable
        columns={columns}
        data={filesWithIds}
        config={TABLE_CONFIG}
        onRowClick={(row) => attachFile(row as TFile)}
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
