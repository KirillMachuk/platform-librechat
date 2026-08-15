import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import copy from 'copy-to-clipboard';
import { useRecoilValue } from 'recoil';
import type { Artifact } from '~/common';
import { logger, decodeBytes, sortPagesByRelevance, triggerDownload } from '~/utils';
import { fileTypeMeta } from '~/components/Chat/Input/Files/typeMeta';
import CopyButton from '~/components/Messages/Content/CopyButton';
import { useFileDownload, useFilePreview } from '~/data-provider';
import { useLocalize, TranslationKeys } from '~/hooks';
import { Download } from '~/components/icons';
import store from '~/store';

type PreviewKind = 'pdf' | 'text' | 'office' | false;

/* Must stay in sync with `OFFICE_EXTENSIONS` in
 * `packages/api/src/files/documents/html.ts`. The backend only renders
 * the modern OOXML formats + CSV/TSV via `bufferToOfficeHtml`; legacy
 * formats (.doc/.ppt/.odt/.odp) have no HTML producer, so routing them
 * here would trigger a poll that ends in "ready with no text" and a
 * confusing "Preview unavailable" UX with one wasted request. */
const OFFICE_EXTS = new Set(['docx', 'xlsx', 'xls', 'ods', 'pptx', 'csv', 'tsv']);

/* MIME hints mirror the backend's `officeHtmlBucket` MIME fallback. We
 * intentionally avoid the broad `'opendocument'` substring (it would
 * match .odt/.odp which the backend rejects) and use `ms-excel` /
 * `wordprocessingml` etc. for the modern OOXML/spreadsheet families.
 * `tab-separated` covers `text/tab-separated-values` (TSV) which the
 * backend routes through the CSV producer. */
const OFFICE_MIME_HINTS = [
  'wordprocessingml',
  'spreadsheetml',
  'presentationml',
  'ms-excel',
  'opendocument.spreadsheet',
  'csv',
  'tab-separated',
];

/* Cap for inline text preview. Rendering a multi-MB text/log/json file into a
 * single <pre> freezes the tab, so we only decode the first slice and flag the
 * rest as truncated (the full file stays available via Download). CSV/TSV are
 * unaffected — they render server-side through the bounded office HTML path. */
const TEXT_PREVIEW_MAX_BYTES = 512 * 1024;

const PREVIEW_ERROR_MESSAGES: Record<string, TranslationKeys> = {
  'too-large': 'com_ui_preview_too_large',
  timeout: 'com_ui_preview_timeout',
  'render-failed': 'com_ui_preview_render_failed',
  unsupported: 'com_ui_preview_unavailable',
  empty: 'com_ui_preview_render_failed',
  orphaned: 'com_ui_preview_render_failed',
};

function getFileExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

function canPreviewByMime(mime?: string): PreviewKind {
  if (!mime) {
    return false;
  }
  if (mime.includes('pdf')) {
    return 'pdf';
  }
  if (OFFICE_MIME_HINTS.some((hint) => mime.includes(hint))) {
    return 'office';
  }
  if (
    mime.startsWith('text/') ||
    mime.includes('json') ||
    mime.includes('xml') ||
    mime.includes('javascript') ||
    mime.includes('typescript') ||
    mime.includes('yaml')
  ) {
    return 'text';
  }
  return false;
}

function canPreviewByExt(filename: string): PreviewKind {
  const ext = getFileExtension(filename);
  if (ext === 'pdf') {
    return 'pdf';
  }
  if (OFFICE_EXTS.has(ext)) {
    return 'office';
  }
  const textExts = new Set([
    'txt',
    'md',
    'json',
    'xml',
    'yaml',
    'yml',
    'html',
    'css',
    'js',
    'ts',
    'jsx',
    'tsx',
    'py',
    'rb',
    'java',
    'c',
    'cpp',
    'h',
    'go',
    'rs',
    'sh',
    'sql',
    'log',
  ]);
  return textExts.has(ext) ? 'text' : false;
}

/** Formats bytes with unit suffix (differs from ~/utils/formatBytes which returns a raw number). */
function formatBytes(bytes: number): string {
  if (bytes >= 1048576) {
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

/**
 * The meta line says what CLASS of file this is, in the user's language, from
 * the same map the chip the user clicked draws from. Extension wins over MIME
 * so a `.tsv` mislabeled `text/plain` still reads as a spreadsheet (matches
 * the office HTML dispatcher's precedence); an extension typeMeta does not
 * know falls back to the bare uppercase extension.
 */
function displayTypeMeta(fileType?: string, fileName?: string): { labelKey: string; ext: string } {
  const ext = fileName ? getFileExtension(fileName) : '';
  const byExt = ext ? fileTypeMeta(ext) : null;
  if (byExt != null && byExt.labelKey !== 'com_ui_file_type_file') {
    return { labelKey: byExt.labelKey, ext };
  }
  return { labelKey: fileTypeMeta(fileType ?? '').labelKey, ext };
}

/**
 * Panel body for FILE_PREVIEW artifacts — the routing target for every
 * non-image stored file (owner 14.08-3). Fetches by `file.file_id`: office
 * formats poll the server-rendered HTML, text decodes a bounded slice, pdf
 * shows the browser viewer over a typed blob. Content lives in react-query /
 * local state, never in recoil.
 */
export default function FilePreviewBody({ artifact }: { artifact: Artifact }) {
  const localize = useLocalize();
  const user = useRecoilValue(store.user);
  const fileId = artifact.file?.file_id;
  const fileName = artifact.file?.filename ?? artifact.title ?? '';
  const fileType = artifact.preview?.fileType;
  const fileSize = artifact.preview?.bytes;
  const relevance = artifact.preview?.relevance;
  const pages = artifact.preview?.pages;
  const pageRelevance = artifact.preview?.pageRelevance;
  const { refetch: downloadFile } = useFileDownload(user?.id ?? '', fileId, { direct: false });

  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileBlobUrl, setFileBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [previewTruncated, setPreviewTruncated] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const loadingRef = useRef(false);
  const cancelledRef = useRef(false);

  const previewKind: PreviewKind = canPreviewByMime(fileType) || canPreviewByExt(fileName);

  const officePreviewQuery = useFilePreview(fileId, {
    enabled: previewKind === 'office' && !!fileId,
  });

  const officeHtml = useMemo(() => {
    if (previewKind !== 'office') {
      return null;
    }
    const data = officePreviewQuery.data;
    if (!data || data.status !== 'ready' || data.textFormat !== 'html' || !data.text) {
      return null;
    }
    return data.text;
  }, [previewKind, officePreviewQuery.data]);

  const officeLoading =
    previewKind === 'office' &&
    !officePreviewQuery.isError &&
    (officePreviewQuery.isLoading || officePreviewQuery.data?.status === 'pending');

  const officeErrorKey: TranslationKeys = useMemo(() => {
    const data = officePreviewQuery.data;
    if (officePreviewQuery.isError) {
      return 'com_ui_preview_render_failed';
    }
    if (data?.previewError && PREVIEW_ERROR_MESSAGES[data.previewError]) {
      return PREVIEW_ERROR_MESSAGES[data.previewError];
    }
    return 'com_ui_preview_unavailable';
  }, [officePreviewQuery.isError, officePreviewQuery.data]);

  const officeError =
    previewKind === 'office' &&
    (officePreviewQuery.isError ||
      officePreviewQuery.data?.status === 'failed' ||
      !!officePreviewQuery.data?.previewError ||
      (officePreviewQuery.data?.status === 'ready' && officeHtml == null));

  const loadPreview = useCallback(async () => {
    if (!fileId || !previewKind || previewKind === 'office' || loadingRef.current) {
      return;
    }
    loadingRef.current = true;
    cancelledRef.current = false;
    setLoading(true);
    setPreviewError(false);

    try {
      const result = await downloadFile();
      if (cancelledRef.current || !result.data) {
        if (!cancelledRef.current) {
          setPreviewError(true);
        }
        return;
      }

      const resp = await fetch(result.data);
      const blob = await resp.blob();

      if (cancelledRef.current) {
        return;
      }

      if (previewKind === 'text') {
        const isOversized = blob.size > TEXT_PREVIEW_MAX_BYTES;
        const slice = isOversized ? blob.slice(0, TEXT_PREVIEW_MAX_BYTES) : blob;
        setFileContent(decodeBytes(await slice.arrayBuffer()));
        setPreviewTruncated(isOversized);
      } else {
        const typed = new Blob([blob], { type: 'application/pdf' });
        setFileBlobUrl(URL.createObjectURL(typed));
      }
    } catch {
      if (!cancelledRef.current) {
        setPreviewError(true);
      }
    } finally {
      loadingRef.current = false;
      if (!cancelledRef.current) {
        setLoading(false);
      }
    }
  }, [fileId, previewKind, downloadFile]);

  useEffect(() => {
    if (previewKind && previewKind !== 'office' && !fileContent && !fileBlobUrl) {
      loadPreview();
    }
  }, [previewKind, fileContent, fileBlobUrl, loadPreview]);

  /* The panel swaps artifacts without unmounting (version pager, another chip
   * click) — reset per-file state and revoke the blob on every id change, and
   * once more on unmount. */
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      setFileContent(null);
      setFileBlobUrl((url) => {
        if (url) {
          URL.revokeObjectURL(url);
        }
        return null;
      });
      setPreviewError(false);
      setPreviewTruncated(false);
      setLoading(false);
      setIsCopied(false);
      loadingRef.current = false;
    };
  }, [artifact.id]);

  const handleCopy = useCallback(() => {
    if (!fileContent) {
      return;
    }
    copy(fileContent, { format: 'text/plain' });
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 3000);
  }, [fileContent]);

  const handleDownload = useCallback(async () => {
    if (!fileId) {
      return;
    }
    try {
      const result = await downloadFile();
      if (!result.data) {
        return;
      }
      triggerDownload(result.data, fileName);
    } catch (err) {
      logger.error('[FilePreviewBody] Download failed:', err);
    }
  }, [downloadFile, fileId, fileName]);

  const displayType = useMemo(() => {
    const { labelKey, ext } = displayTypeMeta(fileType, fileName);
    if (labelKey === 'com_ui_file_type_file' && ext) {
      return ext.toUpperCase();
    }
    return localize(labelKey as TranslationKeys);
  }, [fileType, fileName, localize]);

  const sortedPages = useMemo(
    () => (pages && pageRelevance ? sortPagesByRelevance(pages, pageRelevance) : pages),
    [pages, pageRelevance],
  );

  const metaParts: string[] = [displayType];
  if (relevance != null && relevance > 0) {
    metaParts.push(`${localize('com_ui_relevance')}: ${Math.round(relevance * 100)}%`);
  }
  if (fileSize != null && fileSize > 0) {
    metaParts.push(formatBytes(fileSize));
  }
  if (sortedPages && sortedPages.length > 0) {
    metaParts.push(localize('com_file_pages', { pages: sortedPages.join(', ') }));
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-testid="file-preview-body"
      aria-label={`${localize('com_ui_preview')}: ${fileName}`}
    >
      <div className="shrink-0 truncate px-4 pt-3 text-xs text-text-secondary" title={fileName}>
        {metaParts.join(' · ')}
      </div>
      <div className="relative min-h-0 flex-1 overflow-y-auto p-4">
        {(loading || officeLoading) && (
          <div className="flex h-60 items-center justify-center rounded-lg bg-surface-secondary">
            <span className="shimmer text-sm text-text-secondary">
              {officeLoading ? localize('com_ui_preview_rendering') : localize('com_ui_loading')}
            </span>
          </div>
        )}
        {(previewError || officeError) && !officeLoading && (
          <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-lg bg-surface-secondary">
            <span className="text-sm text-text-secondary">
              {previewError ? localize('com_ui_preview_unavailable') : localize(officeErrorKey)}
            </span>
            {fileId && (
              <button
                type="button"
                onClick={handleDownload}
                className="inline-flex items-center gap-1 text-xs text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none"
                aria-label={`${localize('com_ui_download')} ${fileName}`}
              >
                <Download className="size-3" aria-hidden="true" />
                {localize('com_ui_download')}
              </button>
            )}
          </div>
        )}
        {fileBlobUrl && (
          <iframe
            src={fileBlobUrl}
            title={`${localize('com_ui_preview')}: ${fileName}`}
            className="h-full min-h-[60vh] w-full rounded-lg border border-border-light"
          />
        )}
        {officeHtml && (
          <iframe
            srcDoc={officeHtml}
            sandbox="allow-scripts"
            title={`${localize('com_ui_preview')}: ${fileName}`}
            className="h-full min-h-[60vh] w-full rounded-lg border border-border-light bg-white"
          />
        )}
        {fileContent && (
          <>
            <div className="pointer-events-none sticky top-0 z-10 flex justify-end pr-1">
              <CopyButton
                isCopied={isCopied}
                onClick={handleCopy}
                iconOnly
                label={localize('com_ui_copy')}
                className="pointer-events-auto rounded-lg bg-surface-secondary"
              />
            </div>
            <div className="-mt-8 rounded-lg bg-surface-secondary p-4">
              {/* Inter, not mono — document text, canon §6.15. */}
              <pre className="whitespace-pre-wrap break-words pr-8 font-sans text-sm leading-6 text-text-primary">
                {fileContent}
              </pre>
            </div>
            {previewTruncated && (
              <div className="mt-2 rounded-lg bg-surface-secondary px-4 py-2 text-center text-xs text-text-secondary">
                {localize('com_ui_preview_truncated')}
              </div>
            )}
          </>
        )}
        {!previewKind && !loading && (
          <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-lg bg-surface-secondary">
            <span className="text-sm text-text-secondary">
              {localize('com_ui_preview_unavailable')}
            </span>
            {fileId && (
              <button
                type="button"
                onClick={handleDownload}
                className="inline-flex items-center gap-1 text-xs text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none"
                aria-label={`${localize('com_ui_download')} ${fileName}`}
              >
                <Download className="size-3" aria-hidden="true" />
                {localize('com_ui_download')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
