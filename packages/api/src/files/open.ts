import { logger } from '@librechat/data-schemas';
import { mergeFileConfig } from 'librechat-data-provider';
import type { TokenCountFn } from '~/utils/text';
import type { ServerRequest } from '~/types';
import { processTextWithTokenLimit } from '~/utils/text';
import { countTokens } from '~/utils/tokenizer';

/**
 * Tokens one `open_document` call may return. Deliberately far below `fileTokenLimit`
 * (the whole-document budget used when a user attaches a file): a tool result must fit
 * ALONGSIDE the running conversation, and the cheapest models we route to hold ~38k
 * total. It is also the anonymizer's unit of work — the in-country masker runs one slow
 * pass per unseen text, so a smaller slice is a faster first answer. Bigger documents
 * are not truncated, they are read across several calls via `offset`.
 */
export const OPEN_DOCUMENT_SLICE_TOKENS = 8000;

/**
 * Per-call budget for `open_document`: the slice size, clamped by the same
 * `fileTokenLimit` that governs attached-document reading, so an operator who lowers
 * the file budget lowers this too. Never exceeds the slice size — raising
 * `fileTokenLimit` widens whole-document attachments, not tool results.
 */
export function resolveOpenDocumentTokenLimit(req?: ServerRequest): number {
  const fileConfig = mergeFileConfig(req?.config?.fileConfig);
  const fileTokenLimit = req?.body?.fileTokenLimit ?? fileConfig.fileTokenLimit;
  return fileTokenLimit
    ? Math.min(OPEN_DOCUMENT_SLICE_TOKENS, fileTokenLimit)
    : OPEN_DOCUMENT_SLICE_TOKENS;
}

/**
 * Renders one readable slice of a document's full text for the model, in the same
 * "extracted text, budgeted by the real tokenizer" shape used for attachments
 * (`extractFileContext`) — same source field, same limiter, same token accounting.
 * The only addition is `offset`, which turns a one-shot truncation into resumable
 * reading: the returned character range tells the model exactly where to continue.
 *
 * Access control is NOT performed here — the caller must have already resolved the file
 * under the requesting user's scope, since `documentId` originates from the model.
 */
export async function openDocumentSlice({
  documentId,
  filename,
  text,
  offset = 0,
  tokenLimit,
  tokenCountFn = countTokens,
}: {
  documentId: string;
  filename: string;
  text?: string | null;
  offset?: number;
  tokenLimit: number;
  tokenCountFn?: TokenCountFn;
}): Promise<string> {
  if (!text) {
    return `The full text of "${filename}" is not stored (it was uploaded before the library kept full documents). Tell the user to re-upload this file, then read it again.`;
  }

  const total = text.length;
  const requested = Math.trunc(Number(offset));
  const start = Math.min(Math.max(Number.isFinite(requested) ? requested : 0, 0), total);

  if (start >= total) {
    return `Offset ${start} is at or past the end of "${filename}" (${total} characters) — the document has already been read in full. Answer from what you have.`;
  }

  const { text: slice, wasTruncated } = await processTextWithTokenLimit({
    text: text.slice(start),
    tokenLimit,
    tokenCountFn,
  });

  /* A zero-length slice would hand the model the same offset back and invite an endless
   * read loop. It only happens on a pathologically small budget, so say so instead. */
  if (slice.length === 0) {
    return `Could not read "${filename}" at offset ${start}: the configured token budget is too small to return any text.`;
  }

  const end = start + slice.length;
  logger.debug(
    `[open_document] file=${documentId} chars=${start}-${end} of ${total} truncated=${wasTruncated}`,
  );

  const header = `# "${filename}" — characters ${start + 1}-${end} of ${total}`;
  if (!wasTruncated) {
    return `${header} (end of document)\n\n${slice}`;
  }
  return (
    `${header}\n\n${slice}\n\n` +
    `[Truncated at the per-call limit; ${total - end} characters remain. To keep reading, call open_document again with document_id "${documentId}" and offset ${end}.]`
  );
}
