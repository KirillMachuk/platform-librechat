const { logger, runAsSystem } = require('@librechat/data-schemas');
const { getAppConfig } = require('~/server/services/Config');
const { embedStoredFile, logAxiosError } = require('./crud');
const { getFiles, updateFile } = require('~/models');

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
const LEASE_MS = () => intEnv('RAG_EMBED_LEASE_MS', 30 * 60_000);
const TIMEOUT_MS = () => intEnv('RAG_EMBED_TIMEOUT_MS', 30 * 60_000);
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
 * Claims the oldest due record (pending retry or expired processing lease)
 * with a CAS on `{ embeddingStatus, embedNextAt }`, so concurrent loops and
 * multiple instances cannot double-claim.
 * @returns {Promise<MongoFile | null>} the claimed record, or null
 */
async function claimNext() {
  const now = new Date();
  const candidates = await getFiles(
    {
      embeddingStatus: { $in: ['pending', 'processing'] },
      embedNextAt: { $lte: now },
    },
    { embedNextAt: 1, updatedAt: 1 },
    { text: 0 },
  );
  for (const candidate of candidates ?? []) {
    const claimed = await updateFile(
      {
        file_id: candidate.file_id,
        embeddingStatus: 'processing',
        embedNextAt: new Date(Date.now() + LEASE_MS()),
        embedAttempts: (candidate.embedAttempts ?? 0) + 1,
      },
      { embeddingStatus: candidate.embeddingStatus, embedNextAt: candidate.embedNextAt },
    );
    if (claimed) {
      return claimed;
    }
  }
  return null;
}

/** Embeds one claimed record and commits the resulting state transition. */
async function processClaimed(file, appConfig) {
  const startedAt = Date.now();
  try {
    await embedStoredFile({ appConfig, file, timeoutMs: TIMEOUT_MS() });
    const updated = await updateFile({
      file_id: file.file_id,
      embedded: true,
      embeddingStatus: 'ready',
      embedError: null,
    });
    if (!updated) {
      logger.debug(`[embedWorker] ${file.file_id}: record gone after embed (deleted mid-flight)`);
      return;
    }
    logger.info(
      `[embedWorker] embedded ${file.file_id} (${file.filename}) in ${Date.now() - startedAt}ms, attempt ${file.embedAttempts}`,
    );
  } catch (error) {
    logAxiosError({ error, message: `[embedWorker] embed failed for ${file.file_id}` });
    const permanent = isPermanentFailure(error);
    const exhausted = (file.embedAttempts ?? 1) >= MAX_ATTEMPTS();
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
      embedNextAt: new Date(Date.now() + backoffMs(file.embedAttempts ?? 1)),
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
    while (running) {
      try {
        const appConfig = await getAppConfig({ baseOnly: true });
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
