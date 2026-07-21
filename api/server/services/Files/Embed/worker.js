const { logger, runAsSystem } = require('@librechat/data-schemas');
const { getAppConfig } = require('~/server/services/Config');
const { invalidateProjectContext } = require('~/server/services/Projects/context');
const {
  embedStoredFile,
  fetchFullText,
  purgeStoredVectors,
  fetchDocMetadata,
  METADATA_TIMEOUT_MS,
  PURGE_TIMEOUT_MS,
  logAxiosError,
} = require('./crud');
const { claimNextEmbedFile, updateFile } = require('~/models');

/**
 * Background RAG-embedding worker (RAG_ASYNC_EMBED).
 *
 * Mongo is the queue: upload persists the file record with
 * `embeddingStatus: 'pending'`, the worker claims due records via a CAS
 * update and transitions them to 'ready' (with `embedded: true`) or
 * 'failed'. `embedNextAt` doubles as the retry schedule (pending) and the
 * lease expiry (processing) — a worker crash leaves the record claimable
 * again once the lease passes, so no separate boot sweep is needed and
 * multiple server instances stay safe (CAS admits exactly one claimer).
 *
 * Mirrors the deferred-preview lifecycle precedent
 * (`Files/Code/process.js` + `sweepOrphanedPreviews`), with the lease
 * folded into the scheduler field instead of a boot pass.
 */

const enabled = () => process.env.RAG_ASYNC_EMBED === 'true';

const intEnv = (name, fallback) => {
  const value = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const POLL_MS = () => intEnv('RAG_EMBED_POLL_MS', 3_000);
const TIMEOUT_MS = () => intEnv('RAG_EMBED_TIMEOUT_MS', 30 * 60_000);
/* The lease MUST exceed everything one claim does, otherwise it can expire while the first worker
 * is still working and a second worker re-claims the file — a duplicate parse at the (serialized)
 * doc-gateway and a second copy of the vectors. A claim runs the purge, the embed AND the metadata
 * call, so the clamp accounts for all three regardless of the configured value. */
const LEASE_MS = () =>
  Math.max(
    intEnv('RAG_EMBED_LEASE_MS', 40 * 60_000),
    PURGE_TIMEOUT_MS + TIMEOUT_MS() + METADATA_TIMEOUT_MS() + 60_000,
  );
const MAX_ATTEMPTS = () => intEnv('RAG_EMBED_MAX_ATTEMPTS', 5);
const CONCURRENCY = () => intEnv('RAG_EMBED_CONCURRENCY', 1);

/** Exponential backoff for transient failures: 1m, 2m, 4m, 8m, capped at 15m. */
const backoffMs = (attempts) => Math.min(15 * 60_000, 60_000 * 2 ** Math.max(0, attempts - 1));

const isPermanentFailure = (error) => {
  if (error?.permanent === true) {
    return true;
  }
  const status = error?.response?.status;
  return status != null && status >= 400 && status < 500 && status !== 408 && status !== 429;
};

/**
 * Atomically claims the oldest due record (pending retry or expired
 * processing lease) via a single findOneAndUpdate. Atomic claiming means
 * concurrent loops and multiple app instances can never double-claim, and it
 * touches one document instead of materialising the whole pending backlog
 * each poll.
 * @returns {Promise<MongoFile | null>} the claimed record, or null
 */
async function claimNext() {
  return claimNextEmbedFile(LEASE_MS());
}

/** Embeds one claimed record and commits the resulting state transition. */
async function processClaimed(file, appConfig) {
  const startedAt = Date.now();
  const attempt = file.embedAttempts ?? 1;
  try {
    /* Retries must not stack a second copy of the vectors on top of the first: `/embed` appends,
     * so an attempt that died after committing them left them behind (see `purgeStoredVectors`).
     * Only on a retry — the first attempt of a freshly uploaded file_id has nothing to purge, and
     * the happy path should not pay for a delete that can never match anything.
     *
     * A failed purge deliberately fails the whole attempt: embedding on top of vectors we could
     * not remove IS the duplication this prevents. Better a delayed document than a corrupt index. */
    if (attempt > 1) {
      await purgeStoredVectors({ file });
    }
    await embedStoredFile({ appConfig, file, timeoutMs: TIMEOUT_MS() });
    /* Document metadata rides the same state transition: it is fail-open (null on any failure),
     * so the file is marked ready either way — losing attribute filters must not cost the user a
     * searchable document. Extracted after the embed, never before: no point parsing a file that
     * failed to index. */
    /* Metadata and full text are both fail-open riders on this same state transition, and both
     * land on doc-gateway's content-hash cache (the embed above already parsed the document), so
     * they are fetched together rather than in sequence. Losing either must not cost the user a
     * searchable document, hence neither can reject: both resolve to null instead. */
    const [docMetadata, fullText] = await Promise.all([
      fetchDocMetadata({ appConfig, file }),
      fetchFullText({ appConfig, file }),
    ]);
    const updated = await updateFile({
      file_id: file.file_id,
      embedded: true,
      embeddingStatus: 'ready',
      embedError: null,
      ...(docMetadata ? { docMetadata } : {}),
      ...(fullText ? { fullText } : {}),
    });
    if (!updated) {
      logger.debug(`[embedWorker] ${file.file_id}: record gone after embed (deleted mid-flight)`);
      return;
    }
    // A project source only enters getProjectContext's fileIds once embedded=true.
    // The upload handler invalidated the cache while the file was still pending, so
    // without this the newly-searchable file stays hidden until the TTL lapses.
    // Normalize the ObjectId to a string so the cache key matches the upload side,
    // which invalidates with the string `req.user.id`.
    if (file.project_id && file.user) {
      await invalidateProjectContext(String(file.user), file.project_id);
    }
    logger.info(
      `[embedWorker] embedded ${file.file_id} (${file.filename}) in ${Date.now() - startedAt}ms, attempt ${attempt}`,
    );
  } catch (error) {
    logAxiosError({ error, message: `[embedWorker] embed failed for ${file.file_id}` });
    const permanent = isPermanentFailure(error);
    const exhausted = attempt >= MAX_ATTEMPTS();
    if (permanent || exhausted) {
      await updateFile({
        file_id: file.file_id,
        embeddingStatus: 'failed',
        embedError: permanent ? `http-${error?.response?.status ?? 'unsupported'}` : 'max-retries',
      });
      return;
    }
    await updateFile({
      file_id: file.file_id,
      embeddingStatus: 'pending',
      embedNextAt: new Date(Date.now() + backoffMs(attempt)),
      embedError: null,
    });
  }
}

let running = false;

/**
 * Starts the polling loops (no-op when RAG_ASYNC_EMBED is off). Each loop
 * drains due records sequentially and sleeps POLL_MS when idle. Loops run
 * under `runAsSystem` — the File model is tenant-isolated and the worker
 * crosses tenants by design (same as `sweepOrphanedPreviews`).
 */
function startEmbedWorker() {
  if (!enabled() || running) {
    return;
  }
  running = true;
  const loops = CONCURRENCY();
  logger.info(
    `[embedWorker] starting (loops=${loops}, poll=${POLL_MS()}ms, lease=${LEASE_MS()}ms)`,
  );

  const loop = async () => {
    const appConfig = await getAppConfig({ baseOnly: true });
    while (running) {
      try {
        const claimed = await runAsSystem(claimNext);
        if (!claimed) {
          await new Promise((resolve) => setTimeout(resolve, POLL_MS()));
          continue;
        }
        await runAsSystem(() => processClaimed(claimed, appConfig));
      } catch (error) {
        logger.error('[embedWorker] loop iteration failed:', error);
        await new Promise((resolve) => setTimeout(resolve, POLL_MS()));
      }
    }
  };

  for (let i = 0; i < loops; i++) {
    loop();
  }
}

/** Stops the loops after the current iteration (used by tests). */
function stopEmbedWorker() {
  running = false;
}

module.exports = {
  enabled,
  backoffMs,
  claimNext,
  processClaimed,
  startEmbedWorker,
  stopEmbedWorker,
};
