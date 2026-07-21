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
}): Promise<{ text: string; bytes: number; source: string }> {
  if (!process.env.RAG_API_URL) {
    logger.debug('[parseText] RAG_API_URL not defined, falling back to native text parsing');
    return parseTextNative(file);
  }

  if (isMarkdownFile(file)) {
    logger.debug(
      `[parseText] Markdown file detected (${file.originalname}, ${file.mimetype}), using native parsing to preserve raw formatting`,
    );
    return parseTextNative(file);
  }

  const userId = req.user?.id;
  if (!userId) {
    logger.debug('[parseText] No user ID provided, falling back to native text parsing');
    return parseTextNative(file);
  }

  try {
    const healthResponse = await axios.get(`${process.env.RAG_API_URL}/health`, {
      timeout: 10000,
    });
    if (healthResponse?.statusText !== 'OK' && healthResponse?.status !== 200) {
      logger.debug('[parseText] RAG API health check failed, falling back to native parsing');
      return parseTextNative(file);
    }
  } catch (healthError) {
    logAxiosError({
      message: '[parseText] RAG API health check failed, falling back to native parsing:',
      error: healthError,
    });
    return parseTextNative(file);
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
    return parseTextNative(file);
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
