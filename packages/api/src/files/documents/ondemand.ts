import { withTimeout } from '../../utils/promise';
import { bufferToOfficeHtml, officeHtmlBucket } from './html';
import type { OfficeHtmlBucket } from './html';

export const MAX_OFFICE_PREVIEW_BYTES: number = 25 * 1024 * 1024;
export const OFFICE_PREVIEW_TIMEOUT_MS: number = 30 * 1000;

/**
 * Public boolean gate for the office-preview pipeline.
 *
 * The underlying `officeHtmlBucket` predicate lives in `./html` and returns
 * a typed bucket discriminator used internally by the renderer. The JS
 * route layer (`api/server/routes/files`) only needs to know "can this
 * file be previewed via the office pipeline?" — exposing the typed bucket
 * to JS leaks an internal type and historically broke the barrel export
 * (the bucket predicate was never re-exported, so consumers crashed with
 * `officeHtmlBucket is not a function` at runtime).
 *
 * Keep this as the single public entry point; do not re-export
 * `officeHtmlBucket` itself.
 */
export function isOfficeHtmlPreviewable(filename: string, mimeType: string): boolean {
  return officeHtmlBucket(filename, mimeType) !== null;
}

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
