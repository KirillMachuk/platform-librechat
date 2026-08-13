import { Spinner } from '@librechat/client';
import type { TFile } from 'librechat-data-provider';
import type { ExtendedFile } from '~/common';
import { TriangleAlert } from '~/components/icons';
import { fileTypeMeta } from './typeMeta';
import { useLocalize } from '~/hooks';
import SourceIcon from './SourceIcon';
import { cn } from '~/utils';

const FilePreview = ({
  file,
  className = '',
}: {
  file?: Partial<ExtendedFile | TFile>;
  /** Kept in the signature for the artifact chips that still pass it; the
   *  drawing now comes from the file's own mime via typeMeta. */
  fileType?: {
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
  // RAG_ASYNC_EMBED: a failed embed is terminal — the document was uploaded but
  // never made it into the vector store, so search over it silently returns
  // nothing. Surface it instead of letting the file look ready.
  const indexFailed = embeddingStatus === 'failed';
  /* Perplexity's approach (owner 12.08-2, second word): the TYPE is said by
     the drawing, the colour is the text's own — no colour squares, no tinted
     glyphs. `fileType` still supplies the subtitle at the call sites. */
  const meta = fileTypeMeta((file?.type as string | undefined) ?? '');
  const TypeGlyph = meta.Icon;
  return (
    <div
      className={cn(
        'relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl',
        className,
      )}
      title={indexing ? localize('com_ui_indexing') : undefined}
    >
      <TypeGlyph className="h-[22px] w-[22px] text-text-secondary" aria-hidden="true" />
      <SourceIcon source={file?.source} isCodeFile={!!file?.['metadata']?.fileIdentifier} />
      {(uploading || indexing) && (
        <Spinner
          bgOpacity={0.2}
          color="white"
          aria-label={indexing ? localize('com_ui_indexing') : undefined}
          className="absolute inset-0 m-2.5 flex items-center justify-center"
        />
      )}
      {indexFailed && !uploading && (
        <span
          role="img"
          title={localize('com_ui_index_failed')}
          aria-label={localize('com_ui_index_failed')}
          className="absolute inset-0 flex items-center justify-center bg-black/40"
        >
          <TriangleAlert className="size-5 text-amber-400" aria-hidden={true} />
        </span>
      )}
    </div>
  );
};

export default FilePreview;
