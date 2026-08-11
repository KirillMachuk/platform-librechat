import axios from 'axios';
import FormData from 'form-data';
import { createReadStream } from 'fs';
import { logger } from '@librechat/data-schemas';
import { FileSources } from 'librechat-data-provider';
import type { ServerRequest } from '~/types';
import { logAxiosError, readFileAsString } from '~/utils';
import { generateShortLivedToken } from '~/crypto/jwt';

const MARKDOWN_MIME_TYPES = new Set([
  'text/markdown',
  'text/x-markdown',
  'text/md',
  'application/markdown',
  'application/x-markdown',
]);

const MARKDOWN_EXTENSIONS_RE = /\.(md|markdown|mdown|mkdn|mkd|mdwn)$/i;

function normalizeMimeType(mimetype: string): string {
  if (!mimetype) {
    return '';
  }
  const semi = mimetype.indexOf(';');
  const base = semi === -1 ? mimetype : mimetype.slice(0, semi);
  return base.trim().toLowerCase();
}

function isMarkdownFile(file: Express.Multer.File): boolean {
  if (MARKDOWN_MIME_TYPES.has(normalizeMimeType(file.mimetype))) {
    return true;
  }
  return MARKDOWN_EXTENSIONS_RE.test(file.originalname ?? '');
}

const NATIVE_TEXT_MIME_TYPES = new Set([
  'application/json',
  'application/ld+json',
  'application/xml',
  'application/xhtml+xml',
  'application/javascript',
  'application/x-javascript',
  'application/yaml',
  'application/x-yaml',
  'application/sql',
  'application/x-sh',
  'application/x-httpd-php',
]);

const NATIVE_TEXT_EXTENSIONS_RE =
  /\.(txt|text|log|csv|tsv|json|xml|ya?ml|ini|cfg|conf|toml|sql|html?|css|js|jsx|tsx|py|rb|go|rs|java|c|h|cpp|sh|rtf|eml|srt|vtt|tex|md|markdown|mdown|mkdn|mkd|mdwn)$/i;

const BINARY_MIME_PREFIXES = ['image/', 'audio/', 'video/', 'font/'];

/**
 * Whether the declared type says this is text.
 *
 * `parseTextNative` decodes raw bytes as a string, so it is correct for text and nonsense for
 * anything else: on a PDF it returns megabytes of mojibake beginning with `%PDF`, on a DOCX the
 * bytes of a zip. Keyed on the declaration rather than the content, because a Windows-1251
 * contract is indistinguishable from binary once decoded — rejecting those would break exactly
 * the documents this product exists for. A file whose type says nothing is decided by
 * {@link looksBinary} instead.
 */
function isDeclaredText(file: Express.Multer.File): boolean {
  const mimetype = normalizeMimeType(file.mimetype);
  if (mimetype.startsWith('text/') || NATIVE_TEXT_MIME_TYPES.has(mimetype)) {
    return true;
  }
  if (BINARY_MIME_PREFIXES.some((prefix) => mimetype.startsWith(prefix))) {
    return false;
  }
  return NATIVE_TEXT_EXTENSIONS_RE.test(file.originalname ?? '');
}

/** Sampled from the head; a binary payload betrays itself immediately. */
const BINARY_SNIFF_CHARS = 8192;

/**
 * Whether decoded content cannot be text.
 *
 * NUL and C0 control characters do not occur in prose in any single-byte or UTF-8 encoding, but
 * do occur within the first bytes of a PDF, a zip or an image. Deliberately NOT keyed on
 * replacement characters: a Windows-1251 document decoded as UTF-8 is full of them and is
 * perfectly good text.
 */
function looksBinary(text: string): boolean {
  const end = Math.min(text.length, BINARY_SNIFF_CHARS);
  let control = 0;
  for (let i = 0; i < end; i++) {
    const code = text.charCodeAt(i);
    if (code === 0) {
      return true;
    }
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d && code !== 0x0c) {
      control += 1;
    }
  }
  return end > 0 && control / end > 0.01;
}

/**
 * Whether an upstream parse failure means "try again later" rather than "this document is
 * unreadable". doc-gateway answers 503 + Retry-After while its single scan lane is busy, and a
 * request that left this process without an answer means it is restarting or unreachable — in
 * both cases the document is fine and the caller should defer it to the background embed worker.
 *
 * A missing status alone is not enough: an exception raised BEFORE the request goes out (a
 * missing signing secret, an unreadable path) has no status either, and treating it as
 * backpressure would defer every upload forever while telling the user the parser is busy.
 */
function isTransientParseFailure(error: unknown): boolean {
  const failure = error as { response?: { status?: number }; request?: unknown };
  const status = failure?.response?.status;
  if (status != null) {
    return status === 429 || status === 503 || status === 504;
  }
  return failure?.request != null;
}

/**
 * Native parsing, refused for content it cannot actually read.
 *
 * Every fallback in `parseText` goes through here. Guarding only the one after a failed POST
 * left the others — no RAG_API_URL, no user, a failed health check — handing back a scan's own
 * bytes as its text, and the health check fails on every stack restart.
 */
async function nativeFallback(
  file: Express.Multer.File,
  retryable = false,
): Promise<{ text: string; bytes: number; source: string; retryable?: boolean }> {
  const refused = {
    text: '',
    bytes: 0,
    source: FileSources.text,
    ...(retryable ? { retryable: true } : {}),
  };

  if (isDeclaredText(file)) {
    const parsed = await parseTextNative(file);
    return retryable && !parsed.text.trim() ? { ...parsed, retryable: true } : parsed;
  }

  /* An undeclared type still gets a chance: a text file with no extension arrives as
   * application/octet-stream, and refusing those outright would lose documents that read
   * perfectly well. Anything declared binary is refused without reading it at all. */
  if (!isUndeclaredType(file)) {
    return refused;
  }
  const probed = await parseTextNative(file);
  if (looksBinary(probed.text) || !probed.text.trim()) {
    return refused;
  }
  return probed;
}

/** No usable type declaration: neither a meaningful MIME type nor a file extension. */
function isUndeclaredType(file: Express.Multer.File): boolean {
  const mimetype = normalizeMimeType(file.mimetype);
  if (mimetype && mimetype !== 'application/octet-stream' && mimetype !== 'binary/octet-stream') {
    return false;
  }
  return !/\.[a-z0-9]{1,8}$/i.test(file.originalname ?? '');
}

/**
 * Attempts to parse text using RAG API, falls back to native text parsing
 * @param params - The parameters object
 * @param params.req - The Express request object
 * @param params.file - The uploaded file
 * @param params.file_id - The file ID
 * @returns
 */
export async function parseText({
  req,
  file,
  file_id,
}: {
  req: ServerRequest;
  file: Express.Multer.File;
  file_id: string;
}): Promise<{ text: string; bytes: number; source: string; retryable?: boolean }> {
  if (!process.env.RAG_API_URL) {
    logger.debug('[parseText] RAG_API_URL not defined, falling back to native text parsing');
    return nativeFallback(file);
  }

  if (isMarkdownFile(file)) {
    logger.debug(
      `[parseText] Markdown file detected (${file.originalname}, ${file.mimetype}), using native parsing to preserve raw formatting`,
    );
    return nativeFallback(file);
  }

  const userId = req.user?.id;
  if (!userId) {
    logger.debug('[parseText] No user ID provided, falling back to native text parsing');
    return nativeFallback(file);
  }

  try {
    const healthResponse = await axios.get(`${process.env.RAG_API_URL}/health`, {
      timeout: 10000,
    });
    if (healthResponse?.statusText !== 'OK' && healthResponse?.status !== 200) {
      logger.debug('[parseText] RAG API health check failed, falling back to native parsing');
      return nativeFallback(file, true);
    }
  } catch (healthError) {
    logAxiosError({
      message: '[parseText] RAG API health check failed, falling back to native parsing:',
      error: healthError,
    });
    return nativeFallback(file, true);
  }

  try {
    const jwtToken = generateShortLivedToken(userId);
    const formData = new FormData();
    formData.append('file_id', file_id);
    formData.append('file', createReadStream(file.path));

    const formHeaders = formData.getHeaders();

    const response = await axios.post(`${process.env.RAG_API_URL}/text`, formData, {
      headers: {
        Authorization: `Bearer ${jwtToken}`,
        accept: 'application/json',
        ...formHeaders,
      },
      timeout: 300000,
    });

    const responseData = response.data;
    logger.debug(`[parseText] RAG API completed successfully (${response.status})`);

    if (!('text' in responseData)) {
      throw new Error('RAG API did not return parsed text');
    }

    return {
      text: responseData.text,
      bytes: Buffer.byteLength(responseData.text, 'utf8'),
      source: FileSources.text,
    };
  } catch (error) {
    logAxiosError({
      message: '[parseText] RAG API text parsing failed, falling back to native parsing',
      error,
    });
    /* Native parsing is not a fallback for a document — it is a raw text reader. Handing it a
     * scan returned the PDF's own bytes as "extracted text": non-empty, so the retryable cause
     * was discarded and the caller reported a busy scan lane as "this document may be
     * image-based". Measured on the stand: a 6 MB scan that indexes in 34s on its own was lost
     * this way whenever another scan held the lane. */
    return nativeFallback(file, isTransientParseFailure(error));
  }
}

/**
 * Native JavaScript text parsing fallback
 * Simple text file reading - complex formats handled by RAG API
 * @param file - The uploaded file
 * @returns
 */
export async function parseTextNative(file: Express.Multer.File): Promise<{
  text: string;
  bytes: number;
  source: string;
}> {
  const { content: text, bytes } = await readFileAsString(file.path, {
    fileSize: file.size,
  });

  return {
    text,
    bytes,
    source: FileSources.text,
  };
}

/** Extracted text above this is not stored: it would not fit the record, and a silently
 *  truncated contract is worse than an honest "search only" answer — the model cannot see
 *  where the text stopped and would report a missing clause as absent. */
export const FULL_TEXT_MAX_BYTES = 15 * 1024 * 1024;

export interface ExtractDocumentTextParams {
  /** Stream/buffer of the stored original — the same bytes that went to `/embed`. */
  file: NodeJS.ReadableStream | Buffer;
  fileId: string;
  filename: string;
  contentType?: string;
  jwtToken: string;
  ragApiUrl: string;
  timeoutMs?: number;
}

/**
 * Full text of an already-stored document, for on-demand reading (`open_document`) rather
 * than for the prompt. Counterpart to {@link parseText}, which takes a freshly uploaded
 * multer file; this one takes what the embed worker already has — a download stream.
 *
 * **Fail-open**: any failure (network, backpressure, oversized text) returns `null` and the
 * document stays fully searchable, just not readable end to end. Indexing must never fail
 * over text that is a convenience on top of it.
 *
 * The parse itself is effectively free here: doc-gateway caches by content hash across
 * `/embed`, `/metadata` and `/text`, so a document embedded moments earlier is already parsed
 * — a scan is never OCR'd twice.
 */
export async function extractDocumentText({
  file,
  fileId,
  filename,
  contentType,
  jwtToken,
  ragApiUrl,
  timeoutMs = 300000,
}: ExtractDocumentTextParams): Promise<string | null> {
  const formData = new FormData();
  formData.append('file_id', fileId);
  formData.append('file', file, {
    filename,
    contentType: contentType || 'application/octet-stream',
  });

  try {
    const response = await axios.post(`${ragApiUrl}/text`, formData, {
      headers: {
        Authorization: `Bearer ${jwtToken}`,
        accept: 'application/json',
        ...formData.getHeaders(),
      },
      timeout: timeoutMs,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    const text = response.data?.text;
    if (typeof text !== 'string' || text.length === 0) {
      logger.debug(`[documentText] ${fileId}: service returned no text`);
      return null;
    }

    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > FULL_TEXT_MAX_BYTES) {
      logger.info(
        `[documentText] ${fileId}: extracted text is ${Math.round(bytes / 1024 / 1024)}MB, above the ${Math.round(
          FULL_TEXT_MAX_BYTES / 1024 / 1024,
        )}MB store limit — indexed for search only`,
      );
      return null;
    }
    return text;
  } catch (error) {
    logger.warn(
      `[documentText] ${fileId}: extraction failed, document stays searchable but not readable in full: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}
