import { Spinner, TooltipAnchor } from '@librechat/client';
import type { TFile } from 'librechat-data-provider';
import type { ExtendedFile } from '~/common';
import { fileTypeMeta, chipType } from './typeMeta';
import { TriangleAlert } from '~/components/icons';
import { useLocalize } from '~/hooks';
import SourceIcon from './SourceIcon';
import { cn } from '~/utils';

const FilePreview = ({
  file,
  overrideType,
  className = '',
}: {
  file?: Partial<ExtendedFile | TFile>;
  /**
   * Resolved type when the record itself carries none — generated artifact
   * cards hold only a filename, so the caller hands down the extension.
   * Without it those cards drew the generic glyph while the same file in
   * the composer drew its real type (owner 14.08-2).
   */
  overrideType?: string;
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
     glyphs. ONE map decides the drawing everywhere: typeMeta; `chipType`
     falls back to the filename's extension for records whose stored MIME is
     empty or generic (owner 19.08-3 audit). */
  const meta = fileTypeMeta(
    overrideType ?? chipType(file?.type as string | undefined, file?.filename),
  );
  const TypeGlyph = meta.Icon;
  const preview = (
    <div
      className={cn(
        'relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl',
        className,
      )}
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
        <TooltipAnchor
          description={localize('com_ui_index_failed')}
          className="cursor-default"
          render={
            <span
              role="img"
              aria-label={localize('com_ui_index_failed')}
              className="absolute inset-0 flex items-center justify-center bg-black/40"
            >
              <TriangleAlert className="size-5 text-amber-400" aria-hidden={true} />
            </span>
          }
        />
      )}
    </div>
  );
  if (indexing) {
    return (
      <TooltipAnchor
        description={localize('com_ui_indexing')}
        className="cursor-default"
        render={preview}
      />
    );
  }
  return preview;
};

export default FilePreview;
