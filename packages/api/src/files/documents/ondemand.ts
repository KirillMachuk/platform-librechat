import { withTimeout } from '../../utils/promise';
import { bufferToOfficeHtml, officeHtmlBucket } from './html';
import type { OfficeHtmlBucket } from './html';

export const MAX_OFFICE_PREVIEW_BYTES = 25 * 1024 * 1024;
export const OFFICE_PREVIEW_TIMEOUT_MS = 30 * 1000;

export type RenderOfficePreviewError =
  | 'too-large'
  | 'unsupported'
  | 'empty'
  | 'timeout'
  | 'render-failed';

export type RenderOfficePreviewResult =
  | { html: string; bucket: OfficeHtmlBucket }
  | { error: RenderOfficePreviewError };

/**
 * On-demand renderer for office documents in the file-preview pipeline.
 *
 * Wraps `bufferToOfficeHtml` with a size guard and a hard timeout so the
 * existing deferred-preview flow (which writes pre-rendered HTML into
 * the file record at upload time) can be safely reused for files that
 * never went through that path — e.g. arbitrary uploads viewed via the
 * "My Files" dialog.
 *
 * Returns a discriminated union so the caller can persist the specific
 * `previewError` reason without re-classifying generic exceptions.
 *
 * Note: `bufferToOfficeHtml` is CPU-bound (mammoth / SheetJS / JSZip
 * traversal). The 30s timeout guards against a single pathological file
 * blocking the Express event loop indefinitely; the caller should also
 * deduplicate concurrent renders of the same file.
 */
export async function renderOfficePreview(
  buffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<RenderOfficePreviewResult> {
  if (buffer.byteLength === 0) {
    return { error: 'empty' };
  }
  if (buffer.byteLength > MAX_OFFICE_PREVIEW_BYTES) {
    return { error: 'too-large' };
  }
  const bucket = officeHtmlBucket(filename, mimeType);
  if (!bucket) {
    return { error: 'unsupported' };
  }
  try {
    const html = await withTimeout(
      bufferToOfficeHtml(buffer, filename, mimeType),
      OFFICE_PREVIEW_TIMEOUT_MS,
      `Office preview render timed out after ${OFFICE_PREVIEW_TIMEOUT_MS}ms for ${filename}`,
    );
    if (html == null) {
      return { error: 'unsupported' };
    }
    return { html, bucket };
  } catch (err) {
    if (err instanceof Error && err.message.includes('timed out')) {
      return { error: 'timeout' };
    }
    return { error: 'render-failed' };
  }
}
