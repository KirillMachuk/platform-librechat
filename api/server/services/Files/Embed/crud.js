const axios = require('axios');
const FormData = require('form-data');
const { logger } = require('@librechat/data-schemas');
const {
  logAxiosError,
  extractDocMetadata,
  extractDocumentText,
  generateShortLivedToken,
} = require('@librechat/api');
const { getStrategyFunctions } = require('~/server/services/Files/strategies');

/**
 * Document metadata extraction is opt-in so the platform can ship ahead of the doc-gateway that
 * serves `/metadata`, and so it can be switched off without a redeploy if that service is rolled
 * back (mirrors the Ф2 hybrid switch). Off = files stay fully searchable, only attribute filters
 * and the document card go missing.
 */
const metadataEnabled = () =>
  ['true', '1', 'yes', 'on'].includes((process.env.LIBRARY_METADATA_ENABLED ?? '').toLowerCase());

/**
 * Positive integer from env, or the fallback. Guarded on purpose: a value like `"60s"` parses to
 * NaN, and axios treats a NaN timeout as no timeout at all — a hung doc-gateway would then hold
 * the worker's claim on the file forever.
 */
const intEnv = (name, fallback) => {
  const value = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

/**
 * Budget for one `/metadata` call. Defaults to the embed timeout because it is the SAME work on
 * the SAME bytes: on a cold parse cache (every file the backfill touches) the doc-gateway OCRs
 * the scan before it can answer.
 *
 * The invariant that matters: **our timeout must exceed the gateway's own backpressure timeout**
 * (`DOCGW_SCAN_QUEUE_TIMEOUT_S` + `DOCGW_PARSE_TIMEOUT_S`, 25 min on defaults). Give up sooner and
 * the throttling inverts into a firehose: FastAPI does not cancel a handler when the client
 * disconnects, so the abandoned request keeps the single scan slot AND its bytes in RAM, while we
 * are already free to send the next one. The 503 the backfill relies on then never arrives — it
 * would only be raised after 600 s, long past a shorter deadline.
 */
const METADATA_TIMEOUT_MS = () =>
  intEnv('LIBRARY_METADATA_TIMEOUT_MS', intEnv('RAG_EMBED_TIMEOUT_MS', 30 * 60_000));

/**
 * Ceiling for the pre-retry vector purge. Not an env knob: it is a delete-by-id, and if that
 * cannot finish in a minute the store is unhealthy and the attempt should back off anyway.
 */
const PURGE_TIMEOUT_MS = 60_000;

/**
 * Drops any vectors a previous attempt left behind for this file.
 *
 * `/embed` APPENDS — it never replaces a file's existing vectors. An attempt that dies AFTER the
 * vectors are committed (response timeout, dropped connection, worker crash) therefore leaves them
 * in place, and the retry writes a SECOND full copy. Observed on the lab: one file held exactly
 * `RAG_EMBED_MAX_ATTEMPTS` copies of every chunk (1420 rows for 284 unique) and still ended
 * `failed` — silently unsearchable, while its duplicates crowded other documents out of the shared
 * retrieval pool that every library query draws from.
 *
 * Purging a file that has no vectors is a no-op by design: the delete is filtered by file_id, and
 * a 404 means "nothing to delete", which is the state we wanted anyway.
 *
 * @param {object} params
 * @param {MongoFile} params.file - Claimed record; needs `file_id` and `user`.
 * @throws {Error & { response?: import('axios').AxiosResponse }} on any non-404 failure — the
 *   caller must NOT embed after a failed purge, or it recreates the duplication being prevented.
 */
async function purgeStoredVectors({ file }) {
  if (!process.env.RAG_API_URL) {
    throw new Error('RAG_API_URL not defined');
  }
  const jwtToken = generateShortLivedToken(file.user.toString());
  try {
    await axios.delete(`${process.env.RAG_API_URL}/documents`, {
      headers: {
        Authorization: `Bearer ${jwtToken}`,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      data: [file.file_id],
      timeout: PURGE_TIMEOUT_MS,
    });
  } catch (error) {
    if (error?.response?.status === 404) {
      return;
    }
    throw error;
  }
}

/**
 * Embeds an already-stored file into the vector DB by streaming it from
 * permanent storage (local/S3/...) to `RAG_API_URL/embed`.
 *
 * Mirrors `uploadVectors` from `../VectorDB/crud`, but reads from the
 * storage strategy instead of the multer temp file — the temp file is
 * deleted right after the upload response, while the background embed
 * runs minutes later (queue + scan parsing at the doc-gateway).
 *
 * @param {object} params
 * @param {AppConfig} params.appConfig - Base app config; `getDownloadStream`
 *   implementations only read `req.config`, so a `{ config }` stub suffices.
 * @param {MongoFile} params.file - The file record. Must carry `filepath`,
 *   `source`, `filename`, `type`, `user`, and optionally `embedEntityId` —
 *   the entity namespace `/query` will later resolve, so it is passed
 *   verbatim as `entity_id`.
 * @param {number} params.timeoutMs - Hard ceiling for the embed request
 *   (doc-gateway may queue + parse a large scan for many minutes).
 * @returns {Promise<{ embedded: boolean }>}
 * @throws {Error & { response?: import('axios').AxiosResponse }} on HTTP or
 *   network failure — classification (transient vs permanent) is the
 *   worker's job.
 */
async function embedStoredFile({ appConfig, file, timeoutMs }) {
  if (!process.env.RAG_API_URL) {
    throw new Error('RAG_API_URL not defined');
  }

  const { getDownloadStream } = getStrategyFunctions(file.source);
  if (!getDownloadStream) {
    const error = new Error(`No download stream available for source "${file.source}"`);
    error.permanent = true;
    throw error;
  }

  const stream = await getDownloadStream({ config: appConfig }, file.filepath);
  const jwtToken = generateShortLivedToken(file.user.toString());

  const formData = new FormData();
  formData.append('file_id', file.file_id);
  formData.append('file', stream, {
    filename: file.filename,
    contentType: file.type || 'application/octet-stream',
  });
  if (file.embedEntityId) {
    formData.append('entity_id', file.embedEntityId);
  }

  const response = await axios.post(`${process.env.RAG_API_URL}/embed`, formData, {
    headers: {
      Authorization: `Bearer ${jwtToken}`,
      accept: 'application/json',
      ...formData.getHeaders(),
    },
    timeout: timeoutMs,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  const responseData = response.data;
  if (responseData.known_type === false) {
    const error = new Error(`Filetype ${file.type} is not supported by the RAG API`);
    error.permanent = true;
    throw error;
  }
  if (!responseData.status) {
    throw new Error('RAG API returned an unsuccessful embed status');
  }

  return { embedded: Boolean(responseData.known_type) };
}

/**
 * Extracts document-level metadata (type, parties, own date/place, identifiers) for an
 * already-embedded file by streaming it to the doc-gateway's `/metadata`.
 *
 * These fields answer enumeration queries ("all contracts with X", "briefs from 2025") that
 * retrieval cannot: top-K does not fit a set (measured: dense top-5 set-recall 0.54 vs filter
 * 1.00 — parser-bench/rag-recall/RESULTS_META.md).
 *
 * Runs AFTER `embedStoredFile`, on its own stream: the embed POST consumes the first one. The
 * doc-gateway caches its parse by content hash, so a PDF/scan is not parsed twice.
 *
 * **Fail-open by contract** — never throws. A file without metadata stays fully searchable, it
 * just loses attribute filters; indexing must not fail because of them.
 *
 * @param {object} params
 * @param {AppConfig} params.appConfig
 * @param {MongoFile} params.file
 * @returns {Promise<import('librechat-data-provider').TDocMetadata | null>}
 */
async function fetchDocMetadata({ appConfig, file }) {
  if (!metadataEnabled() || !process.env.RAG_API_URL) {
    return null;
  }
  /* Project sources are embedded under the project's own namespace and are deliberately outside
   * the library scope (see primeLibraryScope), so nothing ever reads their metadata. Extracting it
   * would cost a full download plus a doc-gateway round trip per file for data no query touches. */
  if (file.project_id) {
    return null;
  }
  try {
    const { getDownloadStream } = getStrategyFunctions(file.source);
    if (!getDownloadStream) {
      return null;
    }
    const stream = await getDownloadStream({ config: appConfig }, file.filepath);
    return await extractDocMetadata({
      file: stream,
      fileId: file.file_id,
      filename: file.filename,
      contentType: file.type,
      jwtToken: generateShortLivedToken(file.user.toString()),
      ragApiUrl: process.env.RAG_API_URL,
      timeoutMs: METADATA_TIMEOUT_MS(),
    });
  } catch (error) {
    logger.warn(
      `[docMetadata] ${file.file_id}: could not read stored file, skipping metadata: ${error.message}`,
    );
    return null;
  }
}

/**
 * Full text of a stored document, for on-demand reading by `open_document`. Written to
 * `fullText`, never to `text`: the attachment path routes on `text` being present, so putting a
 * large RAG-routed document there would inline it into every message — the blow-up the size
 * routing exists to prevent.
 *
 * Unlike `fetchDocMetadata` this does NOT skip project sources: a document in a project is one
 * the company keeps, and the owner's rule is "if it parsed, the model can read it in full".
 *
 * Fail-open (null on anything): the document stays searchable, it just cannot be read end to end.
 * Runs after the embed for the same reason metadata does — no point parsing what failed to index —
 * and lands on doc-gateway's content-hash cache, so the parse costs nothing and a scan is never
 * OCR'd twice.
 * @returns {Promise<string|null>}
 */
async function fetchFullText({ appConfig, file }) {
  if (!process.env.RAG_API_URL) {
    return null;
  }
  try {
    const { getDownloadStream } = getStrategyFunctions(file.source);
    if (!getDownloadStream) {
      return null;
    }
    const stream = await getDownloadStream({ config: appConfig }, file.filepath);
    return await extractDocumentText({
      file: stream,
      fileId: file.file_id,
      filename: file.filename,
      contentType: file.type,
      jwtToken: generateShortLivedToken(file.user.toString()),
      ragApiUrl: process.env.RAG_API_URL,
      timeoutMs: METADATA_TIMEOUT_MS(),
    });
  } catch (error) {
    logger.warn(
      `[documentText] ${file.file_id}: could not read stored file, skipping full text: ${error.message}`,
    );
    return null;
  }
}

module.exports = {
  embedStoredFile,
  purgeStoredVectors,
  fetchDocMetadata,
  fetchFullText,
  METADATA_TIMEOUT_MS,
  PURGE_TIMEOUT_MS,
  logAxiosError,
};
