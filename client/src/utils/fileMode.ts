import { EToolResources } from 'librechat-data-provider';

/**
 * User-facing file-handling modes for an attachment, surfaced in the chat
 * toolbar. `auto` lets the system decide deterministically (see
 * {@link resolveAutoFileMode}); the others are explicit overrides.
 *
 * - `auto`   — decide by file type + size vs the model's context window
 * - `text`   — extract text/OCR and place it in the prompt (`context`)
 * - `native` — send the file as-is to the provider (vision / native document)
 * - `search` — index the file for relevance search (RAG, `file_search`)
 */
export type FileMode = 'auto' | 'text' | 'native' | 'search';

export type FileModeInput = {
  /** MIME type of the attached file, e.g. `application/pdf`. */
  mimetype: string;
  /** Size of the attached file in bytes. */
  sizeBytes: number;
  /** Context window of the target model, in tokens. Optional — a conservative
   * fallback is used when unknown. */
  modelMaxTokens?: number;
};

/**
 * Rough bytes-per-token ratio for extracted document text. Deliberately small
 * so the "fits whole" estimate stays conservative and we fall back to RAG only
 * when a document is clearly too large.
 */
const BYTES_PER_TOKEN = 4;

/**
 * Fraction of the model's context window we allow a single document to occupy
 * in "whole" mode, leaving headroom for the system prompt, chat history, and
 * the model's answer.
 */
const CONTEXT_FILL_RATIO = 0.6;

/**
 * Byte ceiling for "whole document" mode when the model context window is
 * unknown. Aligned with LibreChat's existing 10MB "large file" notice
 * (`LARGE_FILE_WARNING_BYTES` in `useFileHandling`), so a document large enough
 * to trigger that toast is also the point where Auto switches to RAG. Generous
 * on purpose: a file's byte size overestimates its extracted-text token count
 * (PDF overhead, fonts, images), so most real documents stay in "whole" mode.
 */
const DEFAULT_MAX_WHOLE_BYTES = 10 * 1024 * 1024;

/** Whether a MIME type denotes an image (handled natively via vision). */
export const isImageMimetype = (mimetype: string): boolean => mimetype.startsWith('image/');

/**
 * Largest document size (bytes) we'll send "whole" before preferring RAG.
 * Pure math from the model's context window; no LLM involved.
 */
const wholeDocumentByteLimit = (modelMaxTokens?: number): number => {
  if (modelMaxTokens == null || modelMaxTokens <= 0) {
    return DEFAULT_MAX_WHOLE_BYTES;
  }
  return modelMaxTokens * CONTEXT_FILL_RATIO * BYTES_PER_TOKEN;
};

/**
 * Deterministically choose how an attached file should be handled — no LLM
 * call, just file type + size vs the model's context window.
 *
 * - image            → `undefined` (sent natively to the provider for vision)
 * - document, fits   → `EToolResources.context` (extract text / OCR)
 * - document, large  → `EToolResources.file_search` (RAG)
 *
 * The return value is the `tool_resource` the upload should use, or `undefined`
 * to send the file natively to the provider.
 */
export const resolveAutoFileMode = ({
  mimetype,
  sizeBytes,
  modelMaxTokens,
}: FileModeInput): EToolResources | undefined => {
  if (isImageMimetype(mimetype)) {
    return undefined;
  }

  if (sizeBytes <= wholeDocumentByteLimit(modelMaxTokens)) {
    return EToolResources.context;
  }

  return EToolResources.file_search;
};

/** Maps an explicit (non-auto) UI mode to its `tool_resource` value. */
const EXPLICIT_MODE_TOOL_RESOURCE: Record<Exclude<FileMode, 'auto'>, EToolResources | undefined> = {
  text: EToolResources.context,
  native: undefined,
  search: EToolResources.file_search,
};

/**
 * Resolve the effective `tool_resource` for an attachment given the user's
 * chosen toolbar mode. `auto` defers to {@link resolveAutoFileMode}; any other
 * mode is an explicit override.
 *
 * Images are always sent natively (vision), regardless of mode: the backend
 * rejects images for `file_search`, and the file-mode control is hidden when
 * only images are attached — but the chosen mode is conversation-global and
 * persists, so an explicit `search`/`text` must never leak onto a later image.
 */
export const resolveFileToolResource = (
  mode: FileMode,
  input: FileModeInput,
): EToolResources | undefined => {
  if (isImageMimetype(input.mimetype)) {
    return undefined;
  }
  return mode === 'auto' ? resolveAutoFileMode(input) : EXPLICIT_MODE_TOOL_RESOURCE[mode];
};
