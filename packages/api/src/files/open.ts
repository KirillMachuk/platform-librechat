import { logger } from '@librechat/data-schemas';
import { mergeFileConfig } from 'librechat-data-provider';
import type { LibrarySource } from '~/rag/library';
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
 * Document text actually returned by a call, present ONLY when the caller got text to read.
 * Every other outcome — no stored text, an offset past the end, a budget too small to yield
 * a slice — carries an explanation in `content` and leaves this undefined, so "did a read
 * happen" is answered by the reader itself instead of re-derived from its prose.
 */
export interface OpenDocumentRead {
  /** The slice handed to the model, without the header and continuation lines. */
  text: string;
  /** 0-based character offset the slice starts at. */
  charStart: number;
  /** Character offset one past the slice, i.e. the `offset` that continues the read. */
  charEnd: number;
  /** Length of the whole document. */
  total: number;
}

export interface OpenDocumentResult {
  /** Text for the model: the slice with its header, or why there is nothing to read. */
  content: string;
  read?: OpenDocumentRead;
}

/**
 * Excerpt kept on the source card. The panel under an answer shows the filename, not the
 * text, so the full slice would add tens of KB per read to the stored attachment and the
 * stream for nothing. A short head keeps the card self-describing at negligible cost.
 */
export const OPEN_DOCUMENT_EXCERPT_CHARS = 300;

/**
 * A read document as a source card, in the same shape `library_search` emits — so a document
 * the model READ lands in the answer's source list exactly like one it FOUND, and the list is
 * built from what the tools actually did rather than from what the answer claims.
 *
 * `relevance` is not a retrieval score here — nothing was ranked. It is the value that says
 * "this document is fully in the answer", and it must clear `minRelevanceScore` (the citation
 * filter drops anything below it) — a read that scored itself out of its own source list would
 * be the one bug this feature exists to prevent. The user never sees the number: the source
 * panel renders the filename and pages, and the relevance bar belongs to the search widget,
 * which a read never opens.
 *
 * `pages` stays empty on purpose: reading works on the document's stored text, which carries no
 * page index. An invented page number would point the user at the wrong part of their contract.
 */
export function openDocumentSource({
  fileId,
  fileName,
  read,
}: {
  fileId: string;
  fileName: string;
  read: OpenDocumentRead;
}): LibrarySource {
  return {
    type: 'file',
    fileId,
    fileName,
    content: read.text.slice(0, OPEN_DOCUMENT_EXCERPT_CHARS),
    relevance: 1,
    pages: [],
    pageRelevance: {},
  };
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
}): Promise<OpenDocumentResult> {
  /* Two different documents land here and the advice must fit both: one indexed for search
   * only (too large for full-text storage, or uploaded straight to RAG), and one uploaded
   * before full text was kept at all. "Re-upload it" is wrong for the first — the document
   * would take the same route again — so point at the mechanism that DOES reach it. */
  if (!text) {
    return {
      content: `The full text of "${filename}" is not stored, so it cannot be read end to end — it is indexed for search only. Use library_search to find the relevant passages inside it and answer from those. (If the user needs the whole document read and it is an older upload, re-uploading it to the library may store the text.)`,
    };
  }

  const total = text.length;
  const requested = Math.trunc(Number(offset));
  const start = Math.min(Math.max(Number.isFinite(requested) ? requested : 0, 0), total);

  if (start >= total) {
    return {
      content: `Offset ${start} is at or past the end of "${filename}" (${total} characters) — the document has already been read in full. Answer from what you have.`,
    };
  }

  const { text: slice, wasTruncated } = await processTextWithTokenLimit({
    text: text.slice(start),
    tokenLimit,
    tokenCountFn,
  });

  /* A zero-length slice would hand the model the same offset back and invite an endless
   * read loop. It only happens on a pathologically small budget, so say so instead. */
  if (slice.length === 0) {
    return {
      content: `Could not read "${filename}" at offset ${start}: the configured token budget is too small to return any text.`,
    };
  }

  const end = start + slice.length;
  logger.debug(
    `[open_document] file=${documentId} chars=${start}-${end} of ${total} truncated=${wasTruncated}`,
  );

  const read: OpenDocumentRead = { text: slice, charStart: start, charEnd: end, total };
  const header = `# "${filename}" — characters ${start + 1}-${end} of ${total}`;
  if (!wasTruncated) {
    return { content: `${header} (end of document)\n\n${slice}`, read };
  }
  return {
    content:
      `${header}\n\n${slice}\n\n` +
      `[Truncated at the per-call limit; ${total - end} characters remain. To keep reading, call open_document again with document_id "${documentId}" and offset ${end}.]`,
    read,
  };
}
