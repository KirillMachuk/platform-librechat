const fs = require('fs').promises;
const express = require('express');
const { logger } = require('@librechat/data-schemas');
const {
  logAxiosError,
  refreshS3FileUrls,
  renderOfficePreview,
  isOfficeHtmlPreviewable,
  resolveUploadErrorMessage,
  verifyAgentUploadPermission,
  MAX_OFFICE_PREVIEW_BYTES,
} = require('@librechat/api');
const {
  Time,
  isUUID,
  CacheKeys,
  FileSources,
  ResourceType,
  EModelEndpoint,
  PermissionBits,
  checkOpenAIStorage,
  isAssistantsEndpoint,
} = require('librechat-data-provider');
const {
  filterFile,
  processFileUpload,
  processDeleteRequest,
  processAgentFileUpload,
} = require('~/server/services/Files/process');
const { fileAccess } = require('~/server/middleware/accessResources/fileAccess');
const { getStrategyFunctions } = require('~/server/services/Files/strategies');
const { getOpenAIClient } = require('~/server/controllers/assistants/helpers');
const { canManageResourceType } = require('~/server/middleware/roles/capabilities');
const { checkPermission } = require('~/server/services/PermissionService');
const { hasAccessToFilesViaAgent } = require('~/server/services/Files');
const { cleanFileName, getContentDisposition } = require('~/server/utils/files');
const { getLogStores } = require('~/cache');
const { Readable } = require('stream');
const db = require('~/models');

const router = express.Router();

/**
 * Whether the caller may act on an agent's attached files: its author, an agent
 * manager, or an explicit ACL editor.
 * @param {import('express').Request} req
 * @param {{ _id: import('mongoose').Types.ObjectId, author?: unknown }} agent
 * @returns {Promise<boolean>}
 */
const canEditAgentFiles = async (req, agent) => {
  if (agent.author?.toString() === req.user.id.toString()) {
    return true;
  }
  if (await canManageResourceType(req.user, ResourceType.AGENT)) {
    return true;
  }
  return checkPermission({
    userId: req.user.id,
    role: req.user.role,
    resourceType: ResourceType.AGENT,
    resourceId: agent._id,
    requiredPermission: PermissionBits.EDIT,
  });
};

router.get('/', async (req, res) => {
  try {
    const appConfig = req.config;
    const files = await db.getFiles({ user: req.user.id });
    if (appConfig.fileStrategy === FileSources.s3) {
      try {
        const cache = getLogStores(CacheKeys.S3_EXPIRY_INTERVAL);
        const alreadyChecked = await cache.get(req.user.id);
        if (!alreadyChecked) {
          await refreshS3FileUrls(files, db.batchUpdateFiles);
          await cache.set(req.user.id, true, Time.THIRTY_MINUTES);
        }
      } catch (error) {
        logger.warn('[/files] Error refreshing S3 file URLs:', error);
      }
    }
    res.status(200).send(files);
  } catch (error) {
    logger.error('[/files] Error getting files:', error);
    res.status(400).json({ message: 'Error in request', error: error.message });
  }
});

/**
 * Get files specific to an agent
 * @route GET /files/agent/:agent_id
 * @param {string} agent_id - The agent ID to get files for
 * @returns {Promise<TFile[]>} Array of files attached to the agent
 */
router.get('/agent/:agent_id', async (req, res) => {
  try {
    const { agent_id } = req.params;

    if (!agent_id) {
      return res.status(400).json({ error: 'Agent ID is required' });
    }

    const agent = await db.getAgent({ id: agent_id });
    if (!agent) {
      return res.status(200).json([]);
    }

    if (!(await canEditAgentFiles(req, agent))) {
      return res.status(200).json([]);
    }

    const agentFileIds = [];
    if (agent.tool_resources) {
      for (const [, resource] of Object.entries(agent.tool_resources)) {
        if (resource?.file_ids && Array.isArray(resource.file_ids)) {
          agentFileIds.push(...resource.file_ids);
        }
      }
    }

    if (agentFileIds.length === 0) {
      return res.status(200).json([]);
    }

    const files = await db.getFiles({ file_id: { $in: agentFileIds }, user: agent.author }, null, {
      text: 0,
    });

    res.status(200).json(files);
  } catch (error) {
    logger.error('[/files/agent/:agent_id] Error fetching agent files:', error);
    res.status(500).json({ error: 'Failed to fetch agent files' });
  }
});

router.get('/config', async (req, res) => {
  try {
    const appConfig = req.config;
    res.status(200).json(appConfig.fileConfig);
  } catch (error) {
    logger.error('[/files] Error getting fileConfig', error);
    res.status(400).json({ message: 'Error in request', error: error.message });
  }
});

router.delete('/', async (req, res) => {
  try {
    const { files: _files } = req.body;

    /** @type {MongoFile[]} */
    const files = _files.filter((file) => {
      if (!file.file_id) {
        return false;
      }
      if (!file.filepath) {
        return false;
      }

      if (/^(file|assistant)-/.test(file.file_id)) {
        return true;
      }

      return isUUID.safeParse(file.file_id).success;
    });

    if (files.length === 0) {
      res.status(204).json({ message: 'Nothing provided to delete' });
      return;
    }

    const fileIds = files.map((file) => file.file_id);
    const dbFiles = await db.getFiles({ file_id: { $in: fileIds } });

    const ownedFiles = [];
    const nonOwnedFiles = [];

    for (const file of dbFiles) {
      if (file.user.toString() === req.user.id.toString()) {
        ownedFiles.push(file);
      } else {
        nonOwnedFiles.push(file);
      }
    }

    if (dbFiles.length > 0 && nonOwnedFiles.length === 0) {
      await processDeleteRequest({ req, files: ownedFiles });
      logger.debug(
        `[/files] Files deleted successfully: ${ownedFiles
          .filter((f) => f.file_id)
          .map((f) => f.file_id)
          .join(', ')}`,
      );
      res.status(200).json({ message: 'Files deleted successfully' });
      return;
    }

    let authorizedFiles = [...ownedFiles];
    let unauthorizedFiles = [];

    if (req.body.agent_id && nonOwnedFiles.length > 0) {
      const nonOwnedFileIds = nonOwnedFiles.map((f) => f.file_id);
      const accessMap = await hasAccessToFilesViaAgent({
        userId: req.user.id,
        role: req.user.role,
        fileIds: nonOwnedFileIds,
        agentId: req.body.agent_id,
        isDelete: true,
        files: nonOwnedFiles,
      });

      for (const file of nonOwnedFiles) {
        if (accessMap.get(file.file_id)) {
          authorizedFiles.push(file);
        } else {
          unauthorizedFiles.push(file);
        }
      }
    } else {
      unauthorizedFiles = nonOwnedFiles;
    }

    if (unauthorizedFiles.length > 0) {
      return res.status(403).json({
        message: 'You can only delete files you have access to',
        unauthorizedFiles: unauthorizedFiles.map((f) => f.file_id),
      });
    }

    /* Handle agent unlinking even if no valid files to delete */
    if (req.body.agent_id && req.body.tool_resource && dbFiles.length === 0) {
      const agent = await db.getAgent({
        id: req.body.agent_id,
      });

      const toolResourceFiles = agent.tool_resources?.[req.body.tool_resource]?.file_ids ?? [];
      const agentFiles = files
        .filter((f) => toolResourceFiles.includes(f.file_id))
        .map((file) => ({ tool_resource: req.body.tool_resource, file_id: file.file_id }));
      const unauthorizedFiles = (await canEditAgentFiles(req, agent)) ? [] : agentFiles;
      if (unauthorizedFiles.length > 0) {
        return res.status(403).json({
          message: 'You can only delete files you have access to',
          unauthorizedFiles: unauthorizedFiles.map((file) => file.file_id),
        });
      }

      await db.removeAgentResourceFiles({
        agent_id: req.body.agent_id,
        files: agentFiles,
      });
      res.status(200).json({ message: 'File associations removed successfully from agent' });
      return;
    }

    /* Handle assistant unlinking even if no valid files to delete */
    if (req.body.assistant_id && req.body.tool_resource && dbFiles.length === 0) {
      const assistant = await db.getAssistant({
        id: req.body.assistant_id,
      });

      const toolResourceFiles = assistant.tool_resources?.[req.body.tool_resource]?.file_ids ?? [];
      const assistantFiles = files.filter((f) => toolResourceFiles.includes(f.file_id));

      await processDeleteRequest({ req, files: assistantFiles });
      res.status(200).json({ message: 'File associations removed successfully from assistant' });
      return;
    } else if (
      req.body.assistant_id &&
      req.body.files?.[0]?.filepath === EModelEndpoint.azureAssistants
    ) {
      await processDeleteRequest({ req, files: req.body.files });
      return res
        .status(200)
        .json({ message: 'File associations removed successfully from Azure Assistant' });
    }

    await processDeleteRequest({ req, files: authorizedFiles });

    logger.debug(
      `[/files] Files deleted successfully: ${authorizedFiles
        .filter((f) => f.file_id)
        .map((f) => f.file_id)
        .join(', ')}`,
    );
    res.status(200).json({ message: 'Files deleted successfully' });
  } catch (error) {
    logger.error('[/files] Error deleting files:', error);
    res.status(400).json({ message: 'Error in request', error: error.message });
  }
});

function isValidID(str) {
  return /^[A-Za-z0-9_-]{21}$/.test(str);
}

router.get('/code/download/:session_id/:fileId', async (req, res) => {
  try {
    const { session_id, fileId } = req.params;
    const logPrefix = `Session ID: ${session_id} | File ID: ${fileId} | Code output download requested by user `;
    logger.debug(logPrefix);

    if (!session_id || !fileId) {
      return res.status(400).send('Bad request');
    }

    if (!isValidID(session_id) || !isValidID(fileId)) {
      logger.debug(`${logPrefix} invalid session_id or fileId`);
      return res.status(400).send('Bad request');
    }

    const { getDownloadStream } = getStrategyFunctions(FileSources.execute_code);
    if (!getDownloadStream) {
      logger.warn(
        `${logPrefix} has no stream method implemented for ${FileSources.execute_code} source`,
      );
      return res.status(501).send('Not Implemented');
    }

    /* Code-output downloads are always user-private — `processCodeOutput`
     * persists every code-execution artifact under
     * `metadata.codeEnvRef.kind === 'user'` regardless of which skill
     * the run invoked. Pass `kind: 'user'` + `id: <userId>` so codeapi's
     * `sessionAuth` resolves the matching `<tenant>:user:<userId>`
     * sessionKey; without these query params it 400s with
     * "kind must be one of: skill, agent, user". */
    /** @type {AxiosResponse<ReadableStream> | undefined} */
    const response = await getDownloadStream(
      `${session_id}/${fileId}`,
      {
        kind: 'user',
        id: req.user.id,
      },
      req,
    );
    res.set(response.headers);
    response.data.pipe(res);
  } catch (error) {
    /* `logAxiosError` redacts buffer/stream response bodies — without
     * it, a stream-typed axios failure dumps the entire `Readable`'s
     * internal state (megabytes of socket + readableState) into the
     * log line. Plain `logger.error(error)` would do that here. */
    logAxiosError({ message: 'Error downloading code-output file', error });
    res.status(500).send('Error downloading file');
  }
});

/* Lazy-sweep cutoff: pending records older than this are marked failed
 * on the next poll. 2min is well past the 60s render ceiling, so any
 * `pending` past it is definitively orphaned. Tighter than the boot
 * sweep (5min) since this runs per-request, not per-instance. */
const PREVIEW_LAZY_SWEEP_CUTOFF_MS = 2 * 60 * 1000;

/* In-memory LRU cache for on-demand office HTML preview. Keyed by
 * `${file_id}:${updatedAt.getTime()}` so a re-uploaded record (which
 * changes updatedAt) misses the cache and re-renders. Bounded by both
 * entry count and total bytes — large XLSX/PPTX can produce multi-MB
 * HTML; without a byte cap a busy instance could balloon to GBs. */
const OFFICE_PREVIEW_CACHE_MAX_ENTRIES = 50;
const OFFICE_PREVIEW_CACHE_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const OFFICE_PREVIEW_CACHE_MAX_VALUE_BYTES = 2 * 1024 * 1024;
const officePreviewCache = new Map();
let officePreviewCacheBytes = 0;

const officePreviewCacheGet = (key) => {
  const value = officePreviewCache.get(key);
  if (value === undefined) {
    return undefined;
  }
  officePreviewCache.delete(key);
  officePreviewCache.set(key, value);
  return value;
};

const evictOldest = () => {
  const oldestKey = officePreviewCache.keys().next().value;
  if (oldestKey === undefined) {
    return;
  }
  const oldest = officePreviewCache.get(oldestKey);
  officePreviewCache.delete(oldestKey);
  if (oldest) {
    officePreviewCacheBytes -= oldest.length;
  }
};

const officePreviewCacheSet = (key, html) => {
  const bytes = Buffer.byteLength(html, 'utf8');
  if (bytes > OFFICE_PREVIEW_CACHE_MAX_VALUE_BYTES) {
    return;
  }
  if (officePreviewCache.has(key)) {
    const existing = officePreviewCache.get(key);
    officePreviewCacheBytes -= existing.length;
    officePreviewCache.delete(key);
  }
  while (
    officePreviewCache.size >= OFFICE_PREVIEW_CACHE_MAX_ENTRIES ||
    officePreviewCacheBytes + bytes > OFFICE_PREVIEW_CACHE_MAX_TOTAL_BYTES
  ) {
    if (officePreviewCache.size === 0) {
      break;
    }
    evictOldest();
  }
  officePreviewCache.set(key, html);
  officePreviewCacheBytes += bytes;
};

/* In-flight render dedup: the frontend `useFilePreview` hook polls this
 * endpoint every 2.5s while pending, so a slow render (mammoth on a
 * large DOCX can take several seconds) would otherwise spawn N parallel
 * renders of the same file — pinning a CPU core and blocking the
 * Express event loop. Resolving every concurrent caller from the same
 * Promise eliminates the multiplier. */
const officePreviewInflight = new Map();

const streamToBuffer = (stream, maxBytes) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    stream.on('data', (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > maxBytes) {
        stream.destroy();
        reject(new Error('too-large'));
        return;
      }
      chunks.push(buf);
    });
    stream.on('end', () => resolve(Buffer.concat(chunks, total)));
    stream.on('error', reject);
  });

const officePreviewCacheKey = (file) => {
  const stamp = file.updatedAt instanceof Date ? file.updatedAt.getTime() : 'na';
  return `${file.file_id}:${stamp}`;
};

const loadOfficePreviewBuffer = async (req, file) => {
  const { getDownloadStream } = getStrategyFunctions(file.source);
  if (typeof getDownloadStream !== 'function') {
    return { error: 'unsupported' };
  }
  try {
    const stream = await getDownloadStream(req, file.storageKey || file.filepath);
    const buffer = await streamToBuffer(stream, MAX_OFFICE_PREVIEW_BYTES);
    return { buffer };
  } catch (err) {
    if (err && err.message === 'too-large') {
      return { error: 'too-large' };
    }
    throw err;
  }
};

const renderOfficePreviewOnce = async (req, file, cacheKey) => {
  const loaded = await loadOfficePreviewBuffer(req, file);
  if (loaded.error) {
    return { error: loaded.error };
  }
  const rendered = await renderOfficePreview(loaded.buffer, file.filename, file.type);
  if ('html' in rendered) {
    officePreviewCacheSet(cacheKey, rendered.html);
    return { html: rendered.html };
  }
  return { error: rendered.error };
};

const getOrStartOfficePreview = (req, file, cacheKey) => {
  const existing = officePreviewInflight.get(cacheKey);
  if (existing) {
    return existing;
  }
  const promise = renderOfficePreviewOnce(req, file, cacheKey).finally(() => {
    officePreviewInflight.delete(cacheKey);
  });
  officePreviewInflight.set(cacheKey, promise);
  return promise;
};

/**
 * Poll the lifecycle status of a code-execution file's inline preview.
 *
 * Deferred-preview flow: the immediate persist step writes the file
 * record at `status: 'pending'`; the background render transitions
 * it to `'ready'` (with `text` + `textFormat`) or `'failed'` (with
 * `previewError`). The frontend's `useFilePreview` React Query hook
 * polls this endpoint at ~2.5s intervals while `status === 'pending'`,
 * then auto-stops on terminal status.
 *
 * Returns the smallest viable shape:
 *   - `status` always present (defaults to `'ready'` for legacy records
 *     that never had the field — clients treat absent as ready).
 *   - `text` and `textFormat` only when status is 'ready' AND text
 *     is non-null (preserves the security contract from PR #12934 —
 *     office bucket files MUST NOT receive plain-text fallbacks).
 *   - `previewError` only when status is 'failed'.
 *
 * Lazy-sweeps stale `pending` records on the spot — see
 * `PREVIEW_LAZY_SWEEP_CUTOFF_MS` for the rationale.
 *
 * Reuses the `fileAccess` middleware so ACL is identical to download.
 *
 * @route GET /files/:file_id/preview
 */
router.get('/:file_id/preview', fileAccess, async (req, res) => {
  try {
    const { file_id } = req.params;
    /* `fileAccess` already fetched the record (sans `text`, the default
     * projection drops it). Reuse for the lifecycle check; only re-fetch
     * with `text` on a terminal ready response — the typical lifecycle
     * is N pending polls + 1 ready, so this avoids ~N redundant text
     * reads per file. */
    let file = req.fileAccess.file;
    /* Lazy sweep: if stuck `pending` past the cutoff, mark `failed`
     * conditional on the observed `updatedAt` (concurrent legitimate
     * updates win). */
    if (file.status === 'pending' && file.updatedAt instanceof Date) {
      const ageMs = Date.now() - file.updatedAt.getTime();
      if (ageMs > PREVIEW_LAZY_SWEEP_CUTOFF_MS) {
        const swept = await db.updateFile(
          { file_id, status: 'failed', previewError: 'orphaned' },
          { status: 'pending', updatedAt: file.updatedAt },
        );
        if (swept) {
          file = swept;
          logger.info(
            `[/files/:file_id/preview] Lazy-swept orphaned pending record ${file_id} (age ${Math.round(ageMs / 1000)}s)`,
          );
        }
      }
    }
    /* Default to 'ready' for back-compat: legacy records pre-date the
     * field, and non-office files never get a status set on persist. */
    const status = file.status ?? 'ready';
    const payload = { file_id, status };
    if (status === 'ready') {
      const withText = await db.findFileById(file_id);
      /* On-demand office render (below) needs the ORIGINAL bytes. `FileSources.text`
       * records (the full-text `context` path) discard the original, so they are
       * excluded here: new office uploads are served from the deferred `previewText`
       * branch above, and a legacy context office record with no `previewText`
       * degrades to plain text rather than a doomed stream + `render-failed` on
       * every open. Order matters: `checkOpenAIStorage` stays first so
       * `isOfficeHtmlPreviewable` isn't called for OpenAI storage. */
      const officeEligible =
        !checkOpenAIStorage(file.source) &&
        file.source !== FileSources.text &&
        isOfficeHtmlPreviewable(file.filename, file.type);
      if (withText?.previewText != null) {
        /* Office file taken down the full-text `context` path: its sanitized
         * HTML was rendered (deferred) at upload from the ORIGINAL bytes —
         * every office format (csv/tsv/docx/xlsx/xls/ods/pptx). */
        payload.text = withText.previewText;
        payload.textFormat = 'html';
      } else if (withText?.text != null && (withText.textFormat === 'html' || !officeEligible)) {
        /* Serve stored inline text: already-rendered office HTML (code-exec
         * deferred preview, textFormat==='html') or plain text for non-office
         * files. An office file whose stored text is a plain extract
         * (textFormat !== 'html') deliberately falls through to the on-demand
         * renderer below rather than leaking plain text the office iframe
         * can't use — preserves the PR #12934 no-plain-text-fallback gate. */
        payload.text = withText.text;
        payload.textFormat = withText.textFormat ?? null;
      } else if (officeEligible) {
        const cacheKey = officePreviewCacheKey(file);
        const cached = officePreviewCacheGet(cacheKey);
        if (cached) {
          payload.text = cached;
          payload.textFormat = 'html';
        } else {
          try {
            const rendered = await getOrStartOfficePreview(req, file, cacheKey);
            if (rendered.error) {
              payload.previewError = rendered.error;
            } else {
              payload.text = rendered.html;
              payload.textFormat = 'html';
            }
          } catch (renderErr) {
            logger.warn(
              `[/files/:file_id/preview] On-demand office render failed for ${file_id}:`,
              renderErr,
            );
            payload.previewError = 'render-failed';
          }
        }
      }
    } else if (status === 'failed' && file.previewError) {
      payload.previewError = file.previewError;
    }
    return res.status(200).json(payload);
  } catch (error) {
    logger.error('[/files/:file_id/preview] Error fetching preview status:', error);
    return res
      .status(500)
      .json({ error: 'Internal Server Error', message: 'Failed to fetch preview status' });
  }
});

/**
 * Returns a strategy-managed signed URL for an already-authorized file record.
 */
const getDirectDownloadURL = async ({
  req,
  file,
  customFilename = cleanFileName(file.filename),
}) => {
  const { getDownloadURL } = getStrategyFunctions(file.source);
  if (!getDownloadURL) {
    return null;
  }

  return getDownloadURL({
    req,
    file,
    customFilename,
    contentType: file.type || 'application/octet-stream',
  });
};

// Security allowlist: excludes internal ids, owner/tenant identifiers, and extracted text.
// `filepath` stays included because cached TFile records need it for previews/deletes.
const DOWNLOAD_METADATA_FIELDS = [
  'conversationId',
  'message',
  'file_id',
  'temp_file_id',
  'bytes',
  'model',
  'embedded',
  'filename',
  'filepath',
  'storageKey',
  'storageRegion',
  'object',
  'type',
  'usage',
  'context',
  'source',
  'filterSource',
  'width',
  'height',
  'expiresAt',
  'preview',
  'textFormat',
  'status',
  'previewError',
  'createdAt',
  'updatedAt',
];

const getDownloadFileMetadata = (file) => {
  const rawFile = typeof file.toObject === 'function' ? file.toObject() : file;
  return DOWNLOAD_METADATA_FIELDS.reduce((metadata, field) => {
    if (rawFile[field] !== undefined) {
      metadata[field] = rawFile[field];
    }
    return metadata;
  }, {});
};

router.get('/download-url/:userId/:file_id', fileAccess, async (req, res) => {
  try {
    const { userId, file_id } = req.params;
    logger.debug(`File download URL requested by user ${userId}: ${file_id}`);

    const file = req.fileAccess.file;
    if (checkOpenAIStorage(file.source) && !file.model) {
      logger.warn(
        `File download URL requested by user ${userId} has no associated model: ${file_id}`,
      );
      return res.status(400).send('The model used when creating this file is not available');
    }

    const filename = cleanFileName(file.filename);
    const downloadURL = checkOpenAIStorage(file.source)
      ? null
      : await getDirectDownloadURL({ req, file, customFilename: filename });

    if (!downloadURL) {
      logger.debug(
        `File download URL requested by user ${userId} is not supported for source: ${file.source}`,
      );
      return res.status(501).send('Not Implemented');
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      url: downloadURL,
      filename,
      type: file.type || 'application/octet-stream',
      metadata: getDownloadFileMetadata(file),
    });
  } catch (error) {
    logger.error('[DOWNLOAD URL ROUTE] Error generating file download URL:', error);
    res.status(500).send('Error generating file download URL');
  }
});

router.get('/download/:userId/:file_id', fileAccess, async (req, res) => {
  try {
    const { userId, file_id } = req.params;
    logger.debug(`File download requested by user ${userId}: ${file_id}`);

    // Access already validated by fileAccess middleware
    const file = req.fileAccess.file;

    if (checkOpenAIStorage(file.source) && !file.model) {
      logger.warn(`File download requested by user ${userId} has no associated model: ${file_id}`);
      return res.status(400).send('The model used when creating this file is not available');
    }

    const { getDownloadStream, getDownloadURL } = getStrategyFunctions(file.source);
    if (!getDownloadStream && !getDownloadURL) {
      logger.warn(
        `File download requested by user ${userId} has no download method implemented: ${file.source}`,
      );
      return res.status(501).send('Not Implemented');
    }

    const setHeaders = () => {
      res.setHeader('Content-Disposition', getContentDisposition(file.filename));
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader(
        'X-File-Metadata',
        encodeURIComponent(JSON.stringify(getDownloadFileMetadata(file))),
      );
    };

    if (checkOpenAIStorage(file.source)) {
      req.body = { model: file.model };
      const endpointMap = {
        [FileSources.openai]: EModelEndpoint.assistants,
        [FileSources.azure]: EModelEndpoint.azureAssistants,
      };
      const { openai } = await getOpenAIClient({
        req,
        res,
        overrideEndpoint: endpointMap[file.source],
      });
      logger.debug(`Downloading file ${file_id} from OpenAI`);
      const passThrough = await getDownloadStream(file_id, openai);
      setHeaders();
      logger.debug(`File ${file_id} downloaded from OpenAI`);

      // Handle both Node.js and Web streams
      const stream =
        passThrough.body && typeof passThrough.body.getReader === 'function'
          ? Readable.fromWeb(passThrough.body)
          : passThrough.body;

      stream.pipe(res);
    } else {
      if (getDownloadURL && req.query.direct === 'true') {
        try {
          const downloadURL = await getDirectDownloadURL({ req, file });
          if (downloadURL) {
            res.setHeader('Cache-Control', 'no-store');
            return res.redirect(302, downloadURL);
          }
        } catch (error) {
          logger.warn(
            '[DOWNLOAD ROUTE] Falling back to stream after URL generation failed:',
            error,
          );
        }
      }

      if (!getDownloadStream) {
        logger.warn(
          `File download requested by user ${userId} has no stream method implemented: ${file.source}`,
        );
        return res.status(501).send('Not Implemented');
      }

      const fileStream = await getDownloadStream(req, file.storageKey || file.filepath);

      fileStream.on('error', (streamError) => {
        logger.error('[DOWNLOAD ROUTE] Stream error:', streamError);
      });

      setHeaders();
      fileStream.pipe(res);
    }
  } catch (error) {
    logger.error('[DOWNLOAD ROUTE] Error downloading file:', error);
    res.status(500).send('Error downloading file');
  }
});

router.post('/', async (req, res) => {
  const metadata = req.body;
  let cleanup = true;

  try {
    filterFile({ req });

    metadata.temp_file_id = metadata.file_id;
    metadata.file_id = req.file_id;

    if (isAssistantsEndpoint(metadata.endpoint)) {
      return await processFileUpload({ req, res, metadata });
    }

    const denied = await verifyAgentUploadPermission({
      req,
      res,
      metadata,
      getAgent: db.getAgent,
      checkPermission,
      canManageAgents: () => canManageResourceType(req.user, ResourceType.AGENT),
    });
    if (denied) {
      return;
    }

    return await processAgentFileUpload({ req, res, metadata });
  } catch (error) {
    const message = resolveUploadErrorMessage(error);
    logger.error('[/files] Error processing file:', error);

    try {
      await fs.unlink(req.file.path);
      cleanup = false;
    } catch (error) {
      logger.error('[/files] Error deleting file:', error);
    }
    res.status(500).json({ message });
  } finally {
    if (cleanup) {
      try {
        await fs.unlink(req.file.path);
      } catch (error) {
        // The dual-storage / RAG pipeline may move or remove the temp file as
        // part of normal processing, so it's already gone by the time we clean
        // up. That's expected — only surface unexpected unlink failures.
        if (error?.code === 'ENOENT') {
          logger.debug('[/files] Temp file already removed before cleanup:', req.file.path);
        } else {
          logger.error('[/files] Error deleting file after file processing:', error);
        }
      }
    } else {
      logger.debug('[/files] File processing completed without cleanup');
    }
  }
});

module.exports = router;
