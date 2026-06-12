import { Spinner, FileIcon } from '@librechat/client';
import type { TFile } from 'librechat-data-provider';
import type { ExtendedFile } from '~/common';
import { useLocalize } from '~/hooks';
import SourceIcon from './SourceIcon';
import { cn } from '~/utils';

const FilePreview = ({
  file,
  fileType,
  className = '',
}: {
  file?: Partial<ExtendedFile | TFile>;
  fileType: {
    paths: React.FC;
    fill: string;
    title: string;
  };
  className?: string;
}) => {
  const localize = useLocalize();
  const uploading = typeof file?.['progress'] === 'number' && file['progress'] < 1;
  // RAG_ASYNC_EMBED: after the upload completes the file may still be indexing
  // into the vector store. Keep the spinner up so it doesn't look ready.
  const embeddingStatus = (file as Partial<TFile> | undefined)?.embeddingStatus;
  const indexing = embeddingStatus === 'pending' || embeddingStatus === 'processing';
  return (
    <div className={cn('relative size-10 shrink-0 overflow-hidden rounded-xl', className)}>
      <FileIcon file={file} fileType={fileType} />
      <SourceIcon source={file?.source} isCodeFile={!!file?.['metadata']?.fileIdentifier} />
      {(uploading || indexing) && (
        <Spinner
          bgOpacity={0.2}
          color="white"
          aria-label={indexing ? localize('com_ui_indexing') : undefined}
          className="absolute inset-0 m-2.5 flex items-center justify-center"
        />
      )}
    </div>
  );
};

export default FilePreview;
