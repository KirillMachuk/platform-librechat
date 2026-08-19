import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import copy from 'copy-to-clipboard';
import { useRecoilValue } from 'recoil';
import { TooltipAnchor } from '@librechat/client';
import type { Artifact } from '~/common';
import { cn, logger, decodeBytes, sortPagesByRelevance, triggerDownload } from '~/utils';
import CopyButton from '~/components/Messages/Content/CopyButton';
import { useFileDownload, useFilePreview } from '~/data-provider';
import { useLocalize, TranslationKeys } from '~/hooks';
import { Download } from '~/components/icons';
import PdfPreview from './PdfPreview';
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
  /* Отмена ПО-ЗАПРОСНО (17.08, ревью): общий cancelledRef переживал смену
     artifact.id, и поздний ответ файла A рисовался под именем файла B. Каждая
     загрузка получает свой номер; смена id и размонтирование его инвалидируют. */
  const requestIdRef = useRef(0);
  /* Отзыв blob через ref, не через setState: setState в cleanup
     РАЗМОНТИРУЕМОГО компонента React 18 отбрасывает — URL жил бы до перезагрузки
     вкладки на каждый просмотренный PDF. */
  const blobUrlRef = useRef<string | null>(null);

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
    const requestId = ++requestIdRef.current;
    const isStale = () => requestIdRef.current !== requestId;
    setLoading(true);
    setPreviewError(false);

    try {
      const result = await downloadFile();
      if (isStale()) {
        return;
      }
      if (!result.data) {
        setPreviewError(true);
        return;
      }

      const resp = await fetch(result.data);
      const blob = await resp.blob();

      if (isStale()) {
        return;
      }

      if (previewKind === 'text') {
        const isOversized = blob.size > TEXT_PREVIEW_MAX_BYTES;
        const slice = isOversized ? blob.slice(0, TEXT_PREVIEW_MAX_BYTES) : blob;
        const text = decodeBytes(await slice.arrayBuffer());
        if (isStale()) {
          return;
        }
        setFileContent(text);
        setPreviewTruncated(isOversized);
      } else {
        const typed = new Blob([blob], { type: 'application/pdf' });
        const url = URL.createObjectURL(typed);
        blobUrlRef.current = url;
        setFileBlobUrl(url);
      }
    } catch {
      if (!isStale()) {
        setPreviewError(true);
      }
    } finally {
      if (!isStale()) {
        loadingRef.current = false;
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
   * click) — reset per-file state and revoke the blob on every id change. The
   * revoke goes through the REF: the state updater would also work here, but
   * not in the unmount cleanup below, and one mechanism is easier to trust. */
  useEffect(() => {
    return () => {
      requestIdRef.current += 1;
      loadingRef.current = false;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
      setFileContent(null);
      setFileBlobUrl(null);
      setPreviewError(false);
      setPreviewTruncated(false);
      setLoading(false);
      setIsCopied(false);
    };
  }, [artifact.id]);

  /* Final unmount (panel closed, Escape, conversation switch): React 18 drops
   * setState on an unmounting component, so the id-change cleanup above never
   * revokes the LAST file's blob — this ref-only cleanup does. */
  useEffect(() => {
    return () => {
      requestIdRef.current += 1;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  const handleCopy = useCallback(() => {
    if (!fileContent) {
      return;
    }
    copy(fileContent, { format: 'text/plain' });
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 3000);
  }, [fileContent]);

  /** A PDF blob or a rendered office document — both render as a full-bleed
   *  iframe that scrolls itself. */
  const showsFrame = fileBlobUrl != null || officeHtml != null;

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

  const sortedPages = useMemo(
    () => (pages && pageRelevance ? sortPagesByRelevance(pages, pageRelevance) : pages),
    [pages, pageRelevance],
  );

  /* Only what the document on screen cannot say for itself. Its type and its
     size were the first two things in this strip and the two the reader already
     knows: the name is in the panel header, the type is visible the moment it
     renders, and the byte count answers no question anyone asked while reading
     (owner, 19.08). What stays is the search context — why this file came up
     and which pages matched — which is nowhere else once the result card
     scrolls away. */
  const metaParts: string[] = [];
  if (relevance != null && relevance > 0) {
    metaParts.push(`${localize('com_ui_relevance')}: ${Math.round(relevance * 100)}%`);
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
      {metaParts.length > 0 && (
        <TooltipAnchor
          description={fileName}
          className="cursor-default"
          render={
            <div
              className="shrink-0 truncate px-4 pt-3 text-xs text-text-secondary"
              data-testid="file-preview-meta"
            >
              {metaParts.join(' · ')}
            </div>
          }
        />
      )}
      {/* Кадры (PDF, офис) занимают ВСЮ высоту панели и прокручиваются САМИ:
          пока их прокручивала панель, кадр стоял частично за краем и клик по
          вкладке листа внутри него не доезжал (e2e поймал переключение листов
          xlsx). Текст, наоборот, прокручивается панелью. */}
      <div
        className={cn(
          'relative min-h-0 flex-1',
          showsFrame ? 'overflow-hidden' : 'overflow-y-auto overflow-x-hidden p-4',
        )}
      >
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
          <PdfPreview url={fileBlobUrl} title={`${localize('com_ui_preview')}: ${fileName}`} />
        )}
        {officeHtml && (
          <iframe
            srcDoc={officeHtml}
            sandbox="allow-scripts"
            title={`${localize('com_ui_preview')}: ${fileName}`}
            className="h-full w-full border-0 bg-white"
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
