const fs = require('fs');
const path = require('path');
const mime = require('mime');
const { v4 } = require('uuid');
const {
  isUUID,
  megabyte,
  FileContext,
  FileSources,
  imageExtRegex,
  RetentionMode,
  EModelEndpoint,
  EToolResources,
  mergeFileConfig,
  AgentCapabilities,
  checkOpenAIStorage,
  removeNullishValues,
  isAssistantsEndpoint,
  getEndpointFileConfig,
  documentParserMimeTypes,
} = require('librechat-data-provider');
const { logger, runAsSystem } = require('@librechat/data-schemas');
const {
  sanitizeFilename,
  parseText,
  parseTextNative,
  FULL_TEXT_MAX_BYTES,
  probePdf,
  withTimeout,
  routePdfBySize,
  isContentRoutingEnabled,
  readDocRoutingThresholds,
  isImageOcrEnabled,
  imageOcrMinChars,
  acceptOcrText,
  processAudioFile,
  getStorageMetadata,
  createConcurrencyLimiter,
  sweepExpiredFiles: sweepExpiredFilesWithDeps,
  startExpiredFileSweep: startExpiredFileSweepWithDeps,
} = require('@librechat/api');
const {
  convertImage,
  resizeAndConvert,
  resizeImageBuffer,
} = require('~/server/services/Files/images');
const { addResourceFileId, deleteResourceFileId } = require('~/server/controllers/assistants/v2');
const { getOpenAIClient } = require('~/server/controllers/assistants/helpers');
const { loadAuthValues } = require('~/server/services/Tools/credentials');
const { getFileStrategy } = require('~/server/utils/getFileStrategy');
const { checkCapability } = require('~/server/services/Config');
const { recordAudit } = require('~/server/services/Audit');
const { LB_QueueAsyncCall } = require('~/server/utils/queue');
const { getRetentionExpiry, getAgentFileRetentionExpiry } = require('./retention');
const { getStrategyFunctions } = require('./strategies');
const { determineFileType } = require('~/server/utils');
const { STTService } = require('./Audio/STTService');
const db = require('~/models');

/**
 * Resolves the privacy marker persisted on a new file record. `temporary: true` = the file
 * belongs to a temporary/incognito chat and must never become cross-chat findable.
 *
 * Why this cannot be inferred from `expiredAt` later: under `retentionMode: ALL` EVERY file
 * carries a retention deadline, so "has an expiry date" stopped meaning "temporary" — treating
 * it that way silently emptied the whole library on that config (measured on the lab: every
 * post-retention upload was excluded). Upload time is the one moment the temp status is
 * reliably known, so it is persisted as its own field:
 *   - the explicit `isTemporary` flag always wins (sent by the client for temp chats, and it
 *     also covers uploads racing conversation persistence);
 *   - outside ALL, a retention deadline can only come from a temp chat, so it implies temp —
 *     this closes the "upload into an already-persisted temp chat without the flag" gap;
 *   - under ALL the deadline is universal and means nothing about privacy.
 */
const resolveUploadPrivacy = ({ req, retentionExpiry }) => {
  const isTemporaryUpload = req.body?.isTemporary === true || req.body?.isTemporary === 'true';
  const retentionAll = req.config?.interfaceConfig?.retentionMode === RetentionMode.ALL;
  const temporary = isTemporaryUpload || (!retentionAll && retentionExpiry?.expiredAt != null);
  return { isTemporaryUpload, temporary };
};

/**
 * Upload-path ceiling for the FAST text operations: the PDF routing probe
 * (`probePdf`, a pdfjs text-layer pass) and native/digital text extraction.
 * `parseText` posts to rag_api with its own 300s internal cap — far too long to
 * hold an upload response open — so the handler races these against this shorter
 * timeout and degrades gracefully (probe → route to RAG; plain-text → native
 * parse). NOTE: this is deliberately NOT used for scanned-document OCR, which is
 * legitimately slow — see `DOC_OCR_TIMEOUT_MS`. Overridable via env.
 */
const DOC_PARSE_TIMEOUT_MS = parseInt(process.env.DOC_PARSE_TIMEOUT_MS ?? '', 10) || 30000;

/**
 * Ceiling for the scanned-document OCR fallback (a digital-parser miss → RAG
 * `/text` → doc-gateway → Tesseract). Multi-page scans (e.g. KFC lease PDFs)
 * legitimately take tens of seconds, so this is far more generous than the fast
 * probe/text timeout: capping OCR at 30s would falsely fail real scanned
 * contracts in full-text mode. Still well under `parseText`'s 300s so a truly
 * hung rag_api can't pin the upload. For genuinely large scans prefer the async
 * RAG route (`RAG_AUTO_ROUTE_LARGE_DOC` / `AUTO_ROUTE_BY_TEXT`). Overridable via env.
 */
const DOC_OCR_TIMEOUT_MS = parseInt(process.env.DOC_OCR_TIMEOUT_MS ?? '', 10) || 120000;

/**
 * Separate, more generous ceiling for image OCR (a large multi-region scan is
 * legitimately slower than a text extract). On timeout the caller falls through
 * to the native vision path, so this only bounds how long OCR may block first.
 */
const IMAGE_OCR_TIMEOUT_MS = parseInt(process.env.IMAGE_OCR_TIMEOUT_MS ?? '', 10) || 45000;

/**
 * Creates a modular file upload wrapper that ensures filename sanitization
 * across all storage strategies. This prevents storage-specific implementations
 * from having to handle sanitization individually.
 *
 * @param {Function} uploadFunction - The storage strategy's upload function
 * @returns {Function} - Wrapped upload function with sanitization
 */
const createSanitizedUploadWrapper = (uploadFunction) => {
  return async (params) => {
    const { req, file, file_id, ...restParams } = params;

    // Create a modified file object with sanitized original name
    // This ensures consistent filename handling across all storage strategies
    const sanitizedFile = {
      ...file,
      originalname: sanitizeFilename(file.originalname),
    };

    return uploadFunction({ req, file: sanitizedFile, file_id, ...restParams });
  };
};

const hasCodeEnvRef = (file) => file?.metadata?.codeEnvRef != null;

/**
 * Compensating delete for the synchronous file_search path: storage is written
 * first, then vectors are embedded. If the embed throws, the storage object is
 * orphaned (no DB record is ever created) and the user gets a 500. Roll the
 * storage object back so no orphan survives, then let the caller re-throw the
 * original embed error. The rollback is best-effort — a failure here is logged
 * and swallowed so it never masks the real embed error. `embedded: false`
 * ensures the strategy delete does not attempt a (pointless) RAG delete.
 *
 * @param {object} params
 * @param {ServerRequest} params.req
 * @param {string} params.source - The storage strategy the object was written to.
 * @param {{ filepath?: string, storageKey?: string, storageRegion?: string }} params.storageResult
 * @param {string} params.file_id
 * @returns {Promise<void>}
 */
const rollbackOrphanedStorage = async ({ req, source, storageResult, file_id }) => {
  try {
    const { deleteFile } = getStrategyFunctions(source);
    if (typeof deleteFile !== 'function') {
      logger.warn(
        `[processFileUpload] No delete method for source ${source}; cannot roll back orphaned storage for ${file_id}`,
      );
      return;
    }
    await deleteFile(req, {
      file_id,
      user: req.user.id,
      source,
      embedded: false,
      filepath: storageResult?.filepath,
      storageKey: storageResult?.storageKey,
      storageRegion: storageResult?.storageRegion,
    });
    logger.info(
      `[processFileUpload] Rolled back orphaned storage for ${file_id} after embedding failure`,
    );
  } catch (rollbackError) {
    logger.error(
      `[processFileUpload] Failed to roll back orphaned storage for ${file_id} after embedding failure:`,
      rollbackError,
    );
  }
};

/**
 * Bounds concurrent storage deletes in a single batch request. `DELETE /files`
 * accepts an arbitrary `files[]`, so without a cap a large batch fans out into
 * hundreds of simultaneous S3/local deletes, saturating the event loop and the
 * storage backend. OpenAI-source deletes keep their own leaky-bucket throttle.
 * Read at call time (env is set at boot) so it stays overridable and testable.
 */
const fileDeleteConcurrency = () => {
  const raw = parseInt(process.env.FILE_DELETE_CONCURRENCY ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 15;
};

const isMissingStorageError = (err) => {
  const code = err?.code ?? err?.status ?? err?.statusCode ?? err?.response?.status;
  if ([404, '404', 'ENOENT', 'NoSuchKey', 'NotFound', 'ResourceNotFound'].includes(code)) {
    return true;
  }

  return /(?:file|object|blob|key|resource) (?:not found|does not exist)|no such (?:file|key)/i.test(
    String(err?.message ?? ''),
  );
};

/**
 * Enqueues the delete operation to the leaky bucket queue if necessary, or adds it directly to promises.
 *
 * @param {object} params - The passed parameters.
 * @param {ServerRequest} params.req - The express request object.
 * @param {MongoFile} params.file - The file object to delete.
 * @param {Function} params.deleteFile - The delete file function.
 * @param {Promise[]} params.promises - The array of promises to await.
 * @param {Set<string>} params.resolvedFileIds - File IDs whose storage delete succeeded.
 * @param {Set<string>} params.failedFileIds - File IDs whose storage delete failed.
 * @param {OpenAI | undefined} [params.openai] - If an OpenAI file, the initialized OpenAI client.
 * @param {<T>(task: () => Promise<T>) => Promise<T>} params.limit - Concurrency limiter for
 *   non-OpenAI storage deletes (OpenAI uses its own leaky-bucket throttle).
 */
function enqueueDeleteOperation({
  req,
  file,
  deleteFile,
  promises,
  resolvedFileIds,
  failedFileIds,
  openai,
  limit,
}) {
  if (checkOpenAIStorage(file.source)) {
    // Enqueue to leaky bucket
    promises.push(
      new Promise((resolve, reject) => {
        LB_QueueAsyncCall(
          () => deleteFile(req, file, openai),
          [],
          (err, result) => {
            if (err) {
              if (isMissingStorageError(err)) {
                resolvedFileIds.add(file.file_id);
                logger.warn('File storage was already missing during delete', err);
                resolve(result);
                return;
              }
              failedFileIds.add(file.file_id);
              logger.error('Error deleting file from OpenAI source', err);
              reject(err);
            } else {
              resolvedFileIds.add(file.file_id);
              resolve(result);
            }
          },
        );
      }),
    );
  } else {
    // Run under the concurrency limiter so a large batch does not fan out into
    // hundreds of simultaneous storage deletes.
    promises.push(
      limit(() =>
        deleteFile(req, file)
          .then(() => resolvedFileIds.add(file.file_id))
          .catch((err) => {
            if (isMissingStorageError(err)) {
              resolvedFileIds.add(file.file_id);
              logger.warn('File storage was already missing during delete', err);
              return;
            }
            failedFileIds.add(file.file_id);
            logger.error('Error deleting file', err);
            return Promise.reject(err);
          }),
      ),
    );
  }
}

const getDeleteMethod = ({ source, deletionMethods }) => {
  if (deletionMethods[source]) {
    return deletionMethods[source];
  }

  const { deleteFile } = getStrategyFunctions(source);
  if (!deleteFile) {
    throw new Error(`Delete function not implemented for ${source}`);
  }

  deletionMethods[source] = deleteFile;
  return deleteFile;
};

const createDeleteFileWithSecondaryStorage = ({ source, deleteFile, deletionMethods }) => {
  return async (req, file, openai) => {
    const secondaryDeleteMethods = [];
    if (file.embedded === true && source !== FileSources.vectordb) {
      secondaryDeleteMethods.push(
        getDeleteMethod({ source: FileSources.vectordb, deletionMethods }),
      );
    }
    if (hasCodeEnvRef(file) && source !== FileSources.execute_code) {
      secondaryDeleteMethods.push(
        getDeleteMethod({ source: FileSources.execute_code, deletionMethods }),
      );
    }

    try {
      await deleteFile(req, file, openai);
    } catch (err) {
      if (!isMissingStorageError(err)) {
        throw err;
      }
      logger.warn('Primary file storage was already missing during delete', err);
    }

    await Promise.all(
      secondaryDeleteMethods.map((secondaryDeleteFile) => secondaryDeleteFile(req, file)),
    );
  };
};

// TODO: refactor as currently only image files can be deleted this way
// as other filetypes will not reside in public path
/**
 * Deletes a list of files from the server filesystem and the database.
 *
 * @param {Object} params - The params object.
 * @param {MongoFile[]} params.files - The file objects to delete.
 * @param {ServerRequest} params.req - The express request object.
 * @param {DeleteFilesBody} params.req.body - The request body.
 * @param {string} [params.req.body.agent_id] - The agent ID if file uploaded is associated to an agent.
 * @param {string} [params.req.body.assistant_id] - The assistant ID if file uploaded is associated to an assistant.
 * @param {string} [params.req.body.tool_resource] - The tool resource if assistant file uploaded is associated to a tool resource.
 *
 * @returns {Promise<{ deletedFileIds: string[], failedFileIds: string[] }>}
 * @throws {Error} When storage deletion cannot be scheduled or file metadata cleanup fails.
 */
const processDeleteRequest = async ({ req, files }) => {
  const appConfig = req.config;
  const resolvedFileIds = new Set();
  const failedFileIds = new Set();
  const deletionMethods = {};
  const limit = createConcurrencyLimiter(fileDeleteConcurrency());
  const promises = [];

  /** @type {Record<string, OpenAI | undefined>} */
  const client = { [FileSources.openai]: undefined, [FileSources.azure]: undefined };
  const initializeClients = async () => {
    if (appConfig.endpoints?.[EModelEndpoint.assistants]) {
      const openAIClient = await getOpenAIClient({
        req,
        overrideEndpoint: EModelEndpoint.assistants,
      });
      client[FileSources.openai] = openAIClient.openai;
    }

    if (!appConfig.endpoints?.[EModelEndpoint.azureOpenAI]?.assistants) {
      return;
    }

    const azureClient = await getOpenAIClient({
      req,
      overrideEndpoint: EModelEndpoint.azureAssistants,
    });
    client[FileSources.azure] = azureClient.openai;
  };

  if (req.body.assistant_id !== undefined) {
    await initializeClients();
  }

  const agentFiles = [];

  for (const file of files) {
    const source = file.source ?? FileSources.local;
    if (req.body.agent_id && req.body.tool_resource) {
      agentFiles.push({
        tool_resource: req.body.tool_resource,
        file_id: file.file_id,
      });
    }

    if (source === FileSources.text) {
      resolvedFileIds.add(file.file_id);
      continue;
    }

    if (checkOpenAIStorage(source) && !client[source]) {
      await initializeClients();
    }

    const openai = client[source];

    if (req.body.assistant_id && req.body.tool_resource) {
      promises.push(
        deleteResourceFileId({
          req,
          openai,
          file_id: file.file_id,
          assistant_id: req.body.assistant_id,
          tool_resource: req.body.tool_resource,
        }),
      );
    } else if (req.body.assistant_id) {
      promises.push(openai.beta.assistants.files.del(req.body.assistant_id, file.file_id));
    }

    const deleteFile = getDeleteMethod({ source, deletionMethods });
    enqueueDeleteOperation({
      req,
      file,
      deleteFile: createDeleteFileWithSecondaryStorage({ source, deleteFile, deletionMethods }),
      promises,
      resolvedFileIds,
      failedFileIds,
      openai,
      limit,
    });
  }

  if (agentFiles.length > 0) {
    promises.push(
      db.removeAgentResourceFiles({
        agent_id: req.body.agent_id,
        files: agentFiles,
      }),
    );
  }

  await Promise.allSettled(promises);
  const deletedFileIds = [...resolvedFileIds];
  let metadataDeletedFileIds = deletedFileIds;
  if (deletedFileIds.length > 0) {
    try {
      await db.deleteFiles(deletedFileIds);
    } catch (error) {
      logger.error('Error deleting file metadata after storage deletion', error);
      deletedFileIds.forEach((fileId) => failedFileIds.add(fileId));
      metadataDeletedFileIds = [];
      throw error;
    }
    if (metadataDeletedFileIds.length > 0) {
      try {
        await db.removeAgentResourceFilesFromAllAgents({ file_ids: metadataDeletedFileIds });
      } catch (error) {
        logger.error('Error cleaning up orphaned agent file references', error);
      }
    }
  }

  return {
    deletedFileIds: metadataDeletedFileIds,
    failedFileIds: [...failedFileIds],
  };
};

/**
 * Fully purges a set of files: their pgvector embeddings (for embedded files)
 * first, then storage + metadata via {@link processDeleteRequest}. Project and
 * conversation file sources are dual-stored (storage + pgvector), and the local
 * delete strategy only removes the disk file — vector embeddings would orphan
 * in pgvector otherwise. Vector cleanup is best-effort (`Promise.allSettled`) so
 * a pgvector hiccup never blocks metadata/storage deletion.
 *
 * Shared by the per-file and per-project delete routes so both stay consistent.
 *
 * @param {object} params
 * @param {ServerRequest} params.req
 * @param {MongoFile[]} params.files
 * @returns {Promise<void>}
 */
const purgeFilesWithVectors = async ({ req, files }) => {
  if (!files || files.length === 0) {
    return;
  }

  const { deleteVectors } = require('./VectorDB/crud');
  const vectorDeletions = files
    .filter((file) => file.embedded)
    .map((file) =>
      deleteVectors(req, file).catch((error) =>
        logger.error('[purgeFilesWithVectors] Vector cleanup failed', error),
      ),
    );
  if (vectorDeletions.length > 0) {
    await Promise.allSettled(vectorDeletions);
  }

  await processDeleteRequest({ req, files });
};

/**
 * Deletes expired file storage before removing the corresponding File records.
 *
 * Mongo TTL indexes delete only the metadata document, so file retention uses
 * this application sweep for records with `expiredAt` instead.
 *
 * @param {object} params
 * @param {AppConfig} params.appConfig
 * @param {number} [params.limit]
 * @param {() => Promise<AppConfig>} [params.loadAppConfig]
 * @returns {Promise<{ scanned: number, deleted: number, failed: number }>}
 */
async function sweepExpiredFiles(options = {}) {
  return sweepExpiredFilesWithDeps(options, {
    getExpiredFiles: db.getExpiredFiles,
    processDeleteRequest,
    recordAudit,
    logger,
  });
}

function startExpiredFileSweep(options = {}) {
  return startExpiredFileSweepWithDeps(options, {
    sweepExpiredFiles,
    runAsSystem,
    logger,
  });
}

/**
 * Processes a file URL using a specified file handling strategy. This function accepts a strategy name,
 * fetches the corresponding file processing functions (for saving and retrieving file URLs), and then
 * executes these functions in sequence. It first saves the file using the provided URL and then retrieves
 * the URL of the saved file. If any error occurs during this process, it logs the error and throws an
 * exception with an appropriate message.
 *
 * @param {Object} params - The parameters object.
 * @param {FileSources} params.fileStrategy - The file handling strategy to use.
 * Must be a value from the `FileSources` enum, which defines different file
 * handling strategies (like saving to Firebase, local storage, etc.).
 * @param {string} params.userId - The user's unique identifier. Used for creating user-specific paths or
 * references in the file handling process.
 * @param {string} params.URL - The URL of the file to be processed.
 * @param {string} params.fileName - The name that will be used to save the file (including extension)
 * @param {string} params.basePath - The base path or directory where the file will be saved or retrieved from.
 * @param {FileContext} params.context - The context of the file (e.g., 'avatar', 'image_generation', etc.)
 * @param {string} [params.tenantId] - Optional tenant identifier for tenant-prefixed storage paths.
 * @param {ServerRequest} [params.req] - Request context used to apply data retention metadata.
 * @returns {Promise<MongoFile>} A promise that resolves to the DB representation (MongoFile)
 *  of the processed file. It throws an error if the file processing fails at any stage.
 */
const processFileURL = async ({
  fileStrategy,
  userId,
  URL,
  fileName,
  basePath,
  context,
  tenantId,
  req,
}) => {
  const { saveURL, getFileURL } = getStrategyFunctions(fileStrategy);
  try {
    const savedFile = await saveURL({ userId, URL, fileName, basePath, tenantId });
    if (!savedFile) {
      throw new Error(`Strategy "${fileStrategy}" did not save "${fileName}"`);
    }

    const {
      bytes = 0,
      type = '',
      dimensions = {},
    } = typeof savedFile === 'string' ? {} : savedFile;
    const fallbackFileName =
      fileStrategy === FileSources.local || fileStrategy === FileSources.firebase
        ? `${userId}/${fileName}`
        : fileName;
    const filepath =
      typeof savedFile === 'string'
        ? savedFile
        : (savedFile.filepath ??
          (await getFileURL({ userId, fileName: fallbackFileName, basePath, tenantId })));
    if (!filepath) {
      throw new Error(`Strategy "${fileStrategy}" did not return a file URL for "${fileName}"`);
    }
    const storageMetadata = getStorageMetadata({
      filepath,
      source: fileStrategy,
      storageKey: typeof savedFile === 'string' ? undefined : savedFile.storageKey,
      storageRegion: typeof savedFile === 'string' ? undefined : savedFile.storageRegion,
    });

    return await db.createFile(
      {
        user: userId,
        file_id: v4(),
        bytes,
        filepath,
        ...storageMetadata,
        filename: fileName,
        source: fileStrategy,
        type,
        context,
        ...(await getRetentionExpiry(req)),
        tenantId,
        width: dimensions.width,
        height: dimensions.height,
      },
      true,
    );
  } catch (error) {
    logger.error(`Error while processing the image with ${fileStrategy}:`, error);
    throw new Error(`Failed to process the image with ${fileStrategy}. ${error.message}`);
  }
};

/**
 * Applies the current strategy for image uploads.
 * Saves file metadata to the database with an expiry TTL.
 *
 * @param {Object} params - The parameters object.
 * @param {ServerRequest} params.req - The Express request object.
 * @param {Express.Response} [params.res] - The Express response object.
 * @param {ImageMetadata} params.metadata - Additional metadata for the file.
 * @param {boolean} params.returnFile - Whether to return the file metadata or return response as normal.
 * @returns {Promise<void>}
 */
const processImageFile = async ({ req, res, metadata, returnFile = false }) => {
  const { file } = req;
  const appConfig = req.config;
  const source = getFileStrategy(appConfig, { isImage: true });
  const { handleImageUpload } = getStrategyFunctions(source);
  const { file_id, temp_file_id, endpoint } = metadata;

  const { filepath, bytes, width, height, storageKey, storageRegion } = await handleImageUpload({
    req,
    file,
    file_id,
    endpoint,
  });
  const storageMetadata = getStorageMetadata({ filepath, source, storageKey, storageRegion });

  const result = await db.createFile(
    {
      user: req.user.id,
      file_id,
      temp_file_id,
      bytes,
      filepath,
      ...storageMetadata,
      filename: file.originalname,
      context: FileContext.message_attachment,
      source,
      type: `image/${appConfig.imageOutputType}`,
      ...(await getRetentionExpiry(req)),
      width,
      height,
      tenantId: req.user.tenantId,
    },
    true,
  );

  if (returnFile) {
    return result;
  }
  res.status(200).json({ message: 'File uploaded and processed successfully', ...result });
};

/**
 * Applies the current strategy for image uploads and
 * returns minimal file metadata, without saving to the database.
 *
 * @param {Object} params - The parameters object.
 * @param {ServerRequest} params.req - The Express request object.
 * @param {FileContext} params.context - The context of the file (e.g., 'avatar', 'image_generation', etc.)
 * @param {boolean} [params.resize=true] - Whether to resize and convert the image to target format. Default is `true`.
 * @param {{ buffer: Buffer, width: number, height: number, bytes: number, filename: string, type: string, file_id: string }} [params.metadata] - Required metadata for the file if resize is false.
 * @returns {Promise<{ filepath: string, filename: string, source: string, type: string}>}
 */
const uploadImageBuffer = async ({ req, context, metadata = {}, resize = true }) => {
  const appConfig = req.config;
  const source = getFileStrategy(appConfig, { isImage: true });
  const { saveBuffer } = getStrategyFunctions(source);
  let { buffer, width, height, bytes, filename, file_id, type } = metadata;
  if (resize) {
    file_id = v4();
    type = `image/${appConfig.imageOutputType}`;
    ({ buffer, width, height, bytes } = await resizeAndConvert({
      inputBuffer: buffer,
      desiredFormat: appConfig.imageOutputType,
    }));
    filename = `${path.basename(req.file.originalname, path.extname(req.file.originalname))}.${
      appConfig.imageOutputType
    }`;
  }
  const fileName = `${file_id}-${filename}`;
  const filepath = await saveBuffer({
    userId: req.user.id,
    fileName,
    buffer,
    tenantId: req.user.tenantId,
  });
  const storageMetadata = getStorageMetadata({ filepath, source });
  return await db.createFile(
    {
      user: req.user.id,
      file_id,
      bytes,
      filepath,
      ...storageMetadata,
      filename,
      context,
      source,
      type,
      width,
      ...(await getRetentionExpiry(req)),
      height,
      tenantId: req.user.tenantId,
    },
    true,
  );
};

/**
 * Applies the current strategy for file uploads.
 * Saves file metadata to the database with an expiry TTL.
 * Files must be deleted from the server filesystem manually.
 *
 * @param {Object} params - The parameters object.
 * @param {ServerRequest} params.req - The Express request object.
 * @param {Express.Response} params.res - The Express response object.
 * @param {FileMetadata} params.metadata - Additional metadata for the file.
 * @returns {Promise<void>}
 */
const processFileUpload = async ({ req, res, metadata }) => {
  const appConfig = req.config;
  const isAssistantUpload = isAssistantsEndpoint(metadata.endpoint);
  const assistantSource =
    metadata.endpoint === EModelEndpoint.azureAssistants ? FileSources.azure : FileSources.openai;
  // Use the configured file strategy for regular file uploads (not vectordb)
  const source = isAssistantUpload ? assistantSource : appConfig.fileStrategy;
  const { handleFileUpload } = getStrategyFunctions(source);
  const { file_id, temp_file_id = null } = metadata;

  /** @type {OpenAI | undefined} */
  let openai;
  if (checkOpenAIStorage(source)) {
    ({ openai } = await getOpenAIClient({ req }));
  }

  const { file } = req;
  const sanitizedUploadFn = createSanitizedUploadWrapper(handleFileUpload);
  const {
    id,
    bytes,
    filename,
    filepath: _filepath,
    storageKey: _storageKey,
    storageRegion: _storageRegion,
    embedded,
    height,
    width,
  } = await sanitizedUploadFn({
    req,
    file,
    file_id,
    openai,
  });

  if (isAssistantUpload && !metadata.message_file && !metadata.tool_resource) {
    await openai.beta.assistants.files.create(metadata.assistant_id, {
      file_id: id,
    });
  } else if (isAssistantUpload && !metadata.message_file) {
    await addResourceFileId({
      req,
      openai,
      file_id: id,
      assistant_id: metadata.assistant_id,
      tool_resource: metadata.tool_resource,
    });
  }

  let filepath = isAssistantUpload ? `${openai.baseURL}/files/${id}` : _filepath;
  let storageMetadata = getStorageMetadata({
    filepath,
    source,
    storageKey: _storageKey,
    storageRegion: _storageRegion,
  });
  if (isAssistantUpload && file.mimetype.startsWith('image')) {
    const result = await processImageFile({
      req,
      file,
      metadata: { file_id: v4() },
      returnFile: true,
    });
    filepath = result.filepath;
    storageMetadata = getStorageMetadata({
      filepath,
      source: result.source,
      storageKey: result.storageKey,
      storageRegion: result.storageRegion,
    });
  }

  const result = await db.createFile(
    {
      user: req.user.id,
      file_id: id ?? file_id,
      temp_file_id,
      bytes,
      filepath,
      ...storageMetadata,
      filename: filename ?? sanitizeFilename(file.originalname),
      context: isAssistantUpload ? FileContext.assistants : FileContext.message_attachment,
      model: isAssistantUpload ? req.body.model : undefined,
      type: file.mimetype,
      ...(await getRetentionExpiry(req)),
      embedded,
      source,
      height,
      width,
      tenantId: req.user.tenantId,
    },
    true,
  );
  res.status(200).json({ message: 'File uploaded and processed successfully', ...result });
};

const DEFAULT_RAG_AUTO_ROUTE_BYTES = 250 * 1024;

const ragAutoRouteBytes = () => {
  const raw = parseInt(process.env.RAG_AUTO_ROUTE_LARGE_DOC_BYTES ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RAG_AUTO_ROUTE_BYTES;
};

/**
 * In full-text (`context`) mode the WHOLE extracted document goes inline to the model and through
 * the in-country anonymizer, which masks it in one slow pass for big contracts. Routing large docs
 * to `file_search` (RAG) means only small retrieved chunks are masked, keeping latency low. Opt-in
 * via `RAG_AUTO_ROUTE_LARGE_DOC=true` (off by default, so agents without file_search are unaffected);
 * size threshold via `RAG_AUTO_ROUTE_LARGE_DOC_BYTES`. Images and small files are never rerouted.
 * @param {{ req: ServerRequest, file: Express.Multer.File, toolResource: string, isImage: boolean }} params
 * @returns {Promise<string>} the tool resource to actually use for this upload
 */
const resolveLargeDocRouting = async ({ req, file, toolResource, isImage }) => {
  if (process.env.RAG_AUTO_ROUTE_LARGE_DOC !== 'true') {
    return toolResource;
  }
  if (toolResource !== EToolResources.context || isImage || !file?.size) {
    return toolResource;
  }
  if (file.size < ragAutoRouteBytes()) {
    return toolResource;
  }
  const isFileSearchEnabled = await checkCapability(req, AgentCapabilities.file_search);
  if (!isFileSearchEnabled) {
    return toolResource;
  }
  logger.info(
    `[processAgentFileUpload] auto-routed large document "${file.originalname}" (${file.size} bytes) from full-text to file_search (RAG) to keep anonymizer latency low`,
  );
  return EToolResources.file_search;
};

/**
 * Content-based variant of {@link resolveLargeDocRouting}: routes a PDF to
 * full-text `context` vs `file_search` by its extracted-text size (digital) or
 * page count (scanned) rather than its byte size — a scan is heavy in bytes
 * (image resolution) but light in text, so byte routing wrongly pushed small
 * scanned contracts to RAG. Probes the PDF without OCR (so a scan headed for RAG
 * is never OCR'd twice). Thresholds via `AUTO_CONTEXT_MAX_CHARS` /
 * `AUTO_CONTEXT_MAX_SCAN_PAGES`. Only PDFs are sized by content; non-PDF
 * documents fall back to the byte-size reroute so large office docs still go to
 * RAG as before. Non-`context` modes and images are returned unchanged.
 * @param {{ req: ServerRequest, file: Express.Multer.File, toolResource: string, isImage: boolean }} params
 * @returns {Promise<{ toolResource: string, pdfText?: string }>} the tool resource to use, plus the
 *   probe's already-extracted text when a digital PDF stays in `context` (so it isn't parsed twice)
 */
const resolveContentRouting = async ({ req, file, toolResource, isImage }) => {
  if (toolResource !== EToolResources.context || isImage) {
    return { toolResource };
  }
  if (file?.mimetype !== 'application/pdf' || !file?.path) {
    return { toolResource: await resolveLargeDocRouting({ req, file, toolResource, isImage }) };
  }
  const isFileSearchEnabled = await checkCapability(req, AgentCapabilities.file_search);
  if (!isFileSearchEnabled) {
    return { toolResource };
  }
  // Bound the routing probe: a pathological PDF must not hang the upload while
  // pdfjs churns. On timeout, route to file_search (RAG) — the safe default for
  // a large/slow document (it would head there by size anyway).
  let probe;
  try {
    probe = await withTimeout(
      probePdf(file.path),
      DOC_PARSE_TIMEOUT_MS,
      `PDF routing probe timed out for "${file.originalname}"`,
    );
  } catch (err) {
    logger.warn(
      `[processAgentFileUpload] ${err.message}; routing to file_search (RAG) to avoid blocking upload`,
    );
    return { toolResource: EToolResources.file_search };
  }
  const { pageCount, textChars, text } = probe;
  const routed = routePdfBySize(pageCount, textChars, readDocRoutingThresholds());
  if (routed === EToolResources.file_search) {
    logger.info(
      `[processAgentFileUpload] content-routed "${file.originalname}" (${pageCount} pages, ${textChars} text chars) from full-text to file_search (RAG)`,
    );
    return { toolResource: routed };
  }
  // Stays in context: hand the already-extracted text to the document branch so a
  // digital PDF's text layer is parsed once here, not again by document_parser.
  return { toolResource: routed, pdfText: text };
};

/**
 * Applies the current strategy for agent file uploads (context / file_search /
 * execute_code), extracting text and persisting the file record.
 *
 * @param {Object} params - The parameters object.
 * @param {ServerRequest} params.req - The Express request object.
 * @param {Express.Response} params.res - The Express response object.
 * @param {FileMetadata} params.metadata - Additional metadata for the file.
 * @returns {Promise<void>}
 */
const processAgentFileUpload = async ({ req, res, metadata }) => {
  const { file } = req;
  const appConfig = req.config;
  const { agent_id, file_id, temp_file_id = null } = metadata;
  let tool_resource = metadata.tool_resource;

  let messageAttachment = !!metadata.message_file;

  if (agent_id && !tool_resource && !messageAttachment) {
    throw new Error('No tool resource provided for agent file upload');
  }

  if (tool_resource === EToolResources.file_search && file.mimetype.startsWith('image')) {
    throw new Error('Image uploads are not supported for file search tool resources');
  }

  if (!messageAttachment && !agent_id) {
    throw new Error('No agent ID provided for agent file upload');
  }

  const isImage = file.mimetype.startsWith('image');
  let fileInfoMetadata;
  const entity_id = messageAttachment === true ? undefined : agent_id;
  const basePath = mime.getType(file.originalname)?.startsWith('image') ? 'images' : 'uploads';
  // Text the content-routing probe already extracted from a digital PDF kept in
  // `context`; reused by resolveDocumentText below to avoid a second pdfjs pass.
  let probedPdfText = null;
  if (isContentRoutingEnabled()) {
    const routed = await resolveContentRouting({ req, file, toolResource: tool_resource, isImage });
    tool_resource = routed.toolResource;
    probedPdfText = routed.pdfText ?? null;
  } else {
    tool_resource = await resolveLargeDocRouting({
      req,
      file,
      toolResource: tool_resource,
      isImage,
    });
  }

  // Auto image-OCR (behind AUTO_IMAGE_OCR): OCR an uploaded image locally; if it yields enough
  // real text, treat it as a full-text `context` document (masked by the anonymizer — more
  // sovereign than vision). Too little / non-text -> fall through to the native vision path.
  let imageOcrText = null;
  if (isImageOcrEnabled() && isImage && tool_resource == null) {
    try {
      const parsed = await withTimeout(
        parseText({ req, file, file_id }),
        IMAGE_OCR_TIMEOUT_MS,
        `image OCR timed out for "${file.originalname}"`,
      );
      if (parsed?.text && acceptOcrText(parsed.text, imageOcrMinChars())) {
        imageOcrText = parsed;
        tool_resource = EToolResources.context;
        logger.info(
          `[processAgentFileUpload] image OCR'd "${file.originalname}" (${parsed.text.length} chars) -> full-text context`,
        );
      } else {
        logger.info(
          `[processAgentFileUpload] image OCR for "${file.originalname}" yielded too little/non-text -> native vision`,
        );
      }
    } catch (err) {
      logger.error(
        `[processAgentFileUpload] image OCR failed for "${file.originalname}", using native vision:`,
        err,
      );
    }
  }

  if (tool_resource === EToolResources.execute_code) {
    const isCodeEnabled = await checkCapability(req, AgentCapabilities.execute_code);
    if (!isCodeEnabled) {
      throw new Error('Code execution is not enabled for Agents');
    }
    const { handleFileUpload: uploadCodeEnvFile } = getStrategyFunctions(FileSources.execute_code);
    const stream = fs.createReadStream(file.path);
    /* Resource identity for codeapi's sessionKey:
     * - chat attachments (messageAttachment=true): `kind: 'user'`, codeapi
     *   buckets under `<tenant>:user:<authContext.userId>` regardless of `id`.
     * - agent setup files (messageAttachment=false): `kind: 'agent'`, shared
     *   per agent identity. `id` carries the agent id. */
    const codeKind = messageAttachment === true ? 'user' : 'agent';
    const codeId = messageAttachment === true ? req.user.id : agent_id;
    /* Upload under the same sanitized filename LC stores in its DB
     * (`fileInfo.filename` below uses `sanitizeFilename(originalname)`).
     * Codeapi/file_server use this as the on-disk name in the sandbox
     * — `/mnt/data/<filename>` — and `primeFiles`'s `toolContext` text
     * + `_injected_files.name` both reference `file.filename`. Sending
     * the unsanitized `file.originalname` here makes the sandbox path
     * (with spaces / special chars) drift from what LC tells the model
     * is available, causing FileNotFoundError on the first reference. */
    const sandboxFilename = sanitizeFilename(file.originalname);
    const uploaded = await uploadCodeEnvFile({
      req,
      stream,
      filename: sandboxFilename,
      kind: codeKind,
      id: codeId,
    });
    /* Persist under the structured `codeEnvRef` shape — the only key the
     * post-cutover schema (`metadata.codeEnvRef`) and downstream readers
     * (`primeFiles`, `getCodeFilesByIds`, `categorizeFileForToolResources`,
     * controller filtering) accept. Storing under the legacy
     * `fileIdentifier` key would be silently dropped by mongoose strict
     * mode and the file would lose its sandbox reference on subsequent
     * priming turns. */
    fileInfoMetadata = {
      codeEnvRef: {
        kind: codeKind,
        id: codeId,
        storage_session_id: uploaded.storage_session_id,
        file_id: uploaded.file_id,
      },
    };
  } else if (tool_resource === EToolResources.file_search) {
    const isFileSearchEnabled = await checkCapability(req, AgentCapabilities.file_search);
    if (!isFileSearchEnabled) {
      throw new Error('File search is not enabled for Agents');
    }
    // Note: File search processing continues to dual storage logic below
  } else if (tool_resource === EToolResources.context) {
    const { file_id, temp_file_id = null } = metadata;

    /**
     * @param {object} params
     * @param {string} params.text
     * @param {number} params.bytes
     * @param {string} params.filepath
     * @param {string} params.type
     * @return {Promise<void>}
     */
    const createTextFile = async ({ text, bytes, type = file.mimetype }) => {
      const textBytes = Buffer.byteLength(text, 'utf8');
      if (textBytes > 15 * megabyte) {
        throw new Error(
          `Extracted text from "${file.originalname}" exceeds the 15MB storage limit (${Math.round(textBytes / megabyte)}MB). Try a shorter document.`,
        );
      }
      const retentionExpiry = await getAgentFileRetentionExpiry({
        req,
        messageAttachment,
        tool_resource,
      });

      /* Retain the ORIGINAL upload in durable storage (same as file_search /
       * plain attachments), alongside the extracted `text` the model reads. The
       * `text` is a doc-gateway/parser reformat — NOT the raw file — so it can't
       * stand in for the original. Keeping the original lets the preview route
       * render office previews on demand from the source bytes, lets the browser
       * preview PDFs, and makes Download work; discarding it (the old behavior)
       * made all three impossible. `text` (what the model reads) is untouched. */
      const storageSource = getFileStrategy(appConfig, { isImage: false });
      const { handleFileUpload } = getStrategyFunctions(storageSource);
      const sanitizedUploadFn = createSanitizedUploadWrapper(handleFileUpload);
      const stored = await sanitizedUploadFn({ req, file, file_id, basePath, entity_id });
      const storageMetadata = getStorageMetadata({
        filepath: stored.filepath,
        source: storageSource,
        storageKey: stored.storageKey,
        storageRegion: stored.storageRegion,
      });

      /* "Index everything" for cross-chat library_search: a `context` file is
       * read as full text in this chat, but we ALSO embed it (async) so the
       * library tool can find it from other chats. `embeddingScope: 'library'`
       * keeps it out of this conversation's retrieval floor (its full text is
       * already inlined — see the floor guards in client.js / resources.ts), so
       * there is no double injection. The stored original is retained above, so
       * the background /embed can stream it.
       *
       * Privacy gates on the persisted `temporary` marker (see
       * resolveUploadPrivacy) — NOT on the retention deadline: under
       * retentionMode ALL every file carries one, and gating on it silently
       * kept the entire library empty on that config. Also skipped when the
       * async worker is off (no one would drain the queue). */
      const { asyncEmbedEnabled } = require('./Embed');
      const { temporary } = resolveUploadPrivacy({ req, retentionExpiry });
      const indexForLibrary = asyncEmbedEnabled() && !temporary;

      const fileInfo = {
        ...removeNullishValues({
          text,
          bytes,
          file_id,
          temp_file_id,
          user: req.user.id,
          type,
          filename: file.originalname,
          model: messageAttachment ? undefined : req.body.model,
          context: messageAttachment ? FileContext.message_attachment : FileContext.agents,
          tenantId: req.user.tenantId,
          filepath: stored.filepath,
          source: storageSource,
          temporary,
          ...storageMetadata,
          ...(indexForLibrary
            ? {
                embeddingStatus: 'pending',
                embedNextAt: new Date(),
                embedAttempts: 0,
                embedEntityId: entity_id,
                embeddingScope: 'library',
              }
            : {}),
        }),
        ...retentionExpiry,
      };

      if (!messageAttachment && tool_resource) {
        await db.addAgentResourceFile({
          file_id,
          agent_id,
          tool_resource,
          updatingUserId: req?.user?.id,
        });
      }
      const result = await db.createFile(fileInfo, true);
      return res
        .status(200)
        .json({ message: 'Agent file uploaded and processed successfully', ...result });
    };

    // Auto image-OCR result: text was already extracted above — persist it as a full-text
    // document and skip the document-parser path (which doesn't handle image MIME types).
    if (imageOcrText) {
      return createTextFile({ text: imageOcrText.text, bytes: imageOcrText.bytes });
    }

    const fileConfig = mergeFileConfig(appConfig.fileConfig);

    const shouldUseConfiguredOCR =
      appConfig?.ocr != null &&
      fileConfig.checkType(file.mimetype, fileConfig.ocr?.supportedMimeTypes || []);

    const shouldUseDocumentParser =
      !shouldUseConfiguredOCR && documentParserMimeTypes.some((regex) => regex.test(file.mimetype));

    const shouldUseOCR = shouldUseConfiguredOCR || shouldUseDocumentParser;

    const resolveDocumentText = async () => {
      if (shouldUseConfiguredOCR) {
        try {
          const ocrStrategy = appConfig?.ocr?.strategy ?? FileSources.document_parser;
          const { handleFileUpload } = getStrategyFunctions(ocrStrategy);
          return await handleFileUpload({ req, file, loadAuthValues });
        } catch (err) {
          logger.error(
            `[processAgentFileUpload] Configured OCR failed for "${file.originalname}", falling back to document_parser:`,
            err,
          );
        }
      }
      // Reuse text the content-routing probe already extracted (a digital PDF kept
      // in `context`) so pdfjs parses the file once, not twice. Placed after
      // configured OCR so a tenant's OCR strategy still wins; the probe text is the
      // same pdfToText output document_parser would produce, so the stored record
      // (text, bytes, filepath) is identical.
      if (probedPdfText != null && probedPdfText.trim()) {
        return {
          filename: file.originalname,
          bytes: Buffer.byteLength(probedPdfText, 'utf8'),
          filepath: FileSources.document_parser,
          text: probedPdfText,
        };
      }
      try {
        const { handleFileUpload } = getStrategyFunctions(FileSources.document_parser);
        return await handleFileUpload({ req, file, loadAuthValues });
      } catch (err) {
        logger.error(
          `[processAgentFileUpload] Document parser failed for "${file.originalname}":`,
          err,
        );
      }
      /* The local document parser (pdfjs) extracts only a PDF's text layer — a scanned PDF
       * has none, so it throws "No text found" and full-text mode fails on scans. Fall back to
       * the RAG API /text endpoint, which routes through doc-gateway (local Tesseract OCR), so
       * scanned contracts work in full-text mode too. No-op if RAG_API_URL is unset/unreachable. */
      try {
        // Bound the OCR fallback so a hung rag_api cannot hold the upload open
        // for its full 300s internal cap — but generously (DOC_OCR_TIMEOUT_MS),
        // because a legitimate multi-page scan (Tesseract) takes tens of seconds
        // and a short cap would falsely fail real scanned contracts. On timeout
        // this rejects, the catch below logs it, resolveDocumentText returns
        // undefined, and the caller raises an honest "unable to extract" error.
        const parsed = await withTimeout(
          parseText({ req, file, file_id }),
          DOC_OCR_TIMEOUT_MS,
          `RAG /text OCR fallback timed out for "${file.originalname}"`,
        );
        if (parsed?.text?.trim()) {
          // filepath = original upload path (matches the native parseText branch below);
          // the extracted text itself is persisted by createTextFile alongside the
          // retained original (source = the configured storage strategy).
          return {
            filename: file.originalname,
            bytes: parsed.bytes,
            filepath: file.path,
            text: parsed.text,
          };
        }
      } catch (err) {
        logger.error(
          `[processAgentFileUpload] RAG /text OCR fallback failed for "${file.originalname}":`,
          err,
        );
      }
    };

    if (shouldUseConfiguredOCR && !(await checkCapability(req, AgentCapabilities.ocr))) {
      throw new Error('OCR capability is not enabled for Agents');
    }

    if (shouldUseOCR) {
      const ocrResult = await resolveDocumentText();
      if (ocrResult) {
        const { text, bytes } = ocrResult;
        return await createTextFile({ text, bytes });
      }
      throw new Error(
        `Unable to extract text from "${file.originalname}". The document may be image-based and requires an OCR service to process.`,
      );
    }

    const shouldUseSTT = fileConfig.checkType(
      file.mimetype,
      fileConfig.stt?.supportedMimeTypes || [],
    );

    if (shouldUseSTT) {
      const sttService = await STTService.getInstance();
      const { text, bytes } = await processAudioFile({ req, file, sttService });
      return await createTextFile({ text, bytes });
    }

    const shouldUseText = fileConfig.checkType(
      file.mimetype,
      fileConfig.text?.supportedMimeTypes || [],
    );

    if (!shouldUseText) {
      throw new Error(`File type ${file.mimetype} is not supported for text parsing.`);
    }

    // For plain-text types the RAG /text pass is an optimization, not a
    // requirement — native parsing reads the file directly and correctly. Bound
    // the RAG attempt so a slow rag_api cannot hold the upload open, and fall
    // back to native (fast, local) on timeout rather than failing the upload.
    let parsedText;
    try {
      parsedText = await withTimeout(
        parseText({ req, file, file_id }),
        DOC_PARSE_TIMEOUT_MS,
        `text parsing timed out for "${file.originalname}"`,
      );
    } catch (err) {
      logger.warn(`[processAgentFileUpload] ${err.message}; falling back to native text parsing`);
      parsedText = await parseTextNative(file);
    }
    const { text, bytes } = parsedText;
    return await createTextFile({ text, bytes, type: file.mimetype });
  }

  // Dual storage pattern for RAG files: Storage + Vector DB
  let storageResult, embeddingResult;
  const isImageFile = file.mimetype.startsWith('image');
  const source = getFileStrategy(appConfig, { isImage: isImageFile });

  /** Full document text for `open_document`, populated on the synchronous embed path only. */
  let ragFullText;
  if (tool_resource === EToolResources.file_search) {
    // FIRST: Upload to Storage for permanent backup (S3/local/etc.)
    const { handleFileUpload } = getStrategyFunctions(source);
    const sanitizedUploadFn = createSanitizedUploadWrapper(handleFileUpload);
    storageResult = await sanitizedUploadFn({
      req,
      file,
      file_id,
      basePath,
      entity_id,
    });

    // SECOND: Upload to Vector DB. With RAG_ASYNC_EMBED the request returns
    // immediately and the background embed worker (Files/Embed) picks the
    // record up from its `embeddingStatus: 'pending'` state — large scans
    // queue + parse for minutes at the doc-gateway and must not hold the
    // upload response open.
    const { asyncEmbedEnabled } = require('./Embed');
    if (asyncEmbedEnabled()) {
      embeddingResult = { embedded: false, filename: file.originalname, deferred: true };
    } else {
      const { uploadVectors } = require('./VectorDB/crud');
      try {
        embeddingResult = await uploadVectors({
          req,
          file,
          file_id,
          entity_id,
        });
      } catch (embedError) {
        // Storage already succeeded above; without this the object would orphan
        // (no DB record is created because the throw aborts before db.createFile).
        await rollbackOrphanedStorage({ req, source, storageResult, file_id });
        throw embedError;
      }

      /* Full text for on-demand reading (`open_document`). Written to `fullText`, never to
       * `text`: the attachment path routes on `text` being present, so a large RAG-routed
       * document there would be inlined into every message.
       *
       * Only on the SYNCHRONOUS embed path — under RAG_ASYNC_EMBED the background worker does
       * this after its embed, where a slow parse costs nobody a held-open upload. Here the
       * document was just parsed by `/embed`, so doc-gateway serves this from its content-hash
       * cache and a scan is never OCR'd twice.
       *
       * Fail-open: the document stays searchable, it just cannot be read end to end. */
      try {
        const parsed = await parseText({ req, file, file_id });
        if (parsed?.text && Buffer.byteLength(parsed.text, 'utf8') <= FULL_TEXT_MAX_BYTES) {
          ragFullText = parsed.text;
        }
      } catch (textError) {
        logger.warn(
          `[processAgentFileUpload] full text unavailable for "${file.originalname}", document stays searchable: ${textError.message}`,
        );
      }
    }

    // Vector status will be stored at root level, no need for metadata
    fileInfoMetadata = {};
  } else {
    // Standard single storage for non-RAG files
    const { handleFileUpload } = getStrategyFunctions(source);
    const sanitizedUploadFn = createSanitizedUploadWrapper(handleFileUpload);
    storageResult = await sanitizedUploadFn({
      req,
      file,
      file_id,
      basePath,
      entity_id,
    });
  }

  let {
    bytes,
    filename,
    filepath: _filepath,
    storageKey: _storageKey,
    storageRegion: _storageRegion,
    height,
    width,
  } = storageResult;
  // For RAG files, use embedding result; for others, use storage result
  let embedded = storageResult.embedded;
  if (tool_resource === EToolResources.file_search) {
    embedded = embeddingResult?.embedded;
    filename = embeddingResult?.filename || filename;
  }

  let filepath = _filepath;
  let storageMetadata = getStorageMetadata({
    filepath,
    source,
    storageKey: _storageKey,
    storageRegion: _storageRegion,
  });

  if (!messageAttachment && tool_resource) {
    await db.addAgentResourceFile({
      file_id,
      agent_id,
      tool_resource,
      updatingUserId: req?.user?.id,
    });
  }

  if (isImage) {
    const result = await processImageFile({
      req,
      file,
      metadata: { file_id: v4() },
      returnFile: true,
    });
    filepath = result.filepath;
    storageMetadata = getStorageMetadata({
      filepath,
      source: result.source,
      storageKey: result.storageKey,
      storageRegion: result.storageRegion,
    });
  }

  const retentionExpiry = await getAgentFileRetentionExpiry({
    req,
    messageAttachment,
    tool_resource,
  });
  const { temporary } = resolveUploadPrivacy({ req, retentionExpiry });
  const fileInfo = {
    ...removeNullishValues({
      user: req.user.id,
      file_id,
      temp_file_id,
      bytes,
      filepath,
      ...storageMetadata,
      filename: filename ?? sanitizeFilename(file.originalname),
      context: messageAttachment ? FileContext.message_attachment : FileContext.agents,
      model: messageAttachment ? undefined : req.body.model,
      metadata: fileInfoMetadata,
      type: file.mimetype,
      embedded,
      fullText: ragFullText,
      source,
      height,
      width,
      temporary,
      tenantId: req.user.tenantId,
      /* Deferred embedding (RAG_ASYNC_EMBED): persist the queue state the
       * background worker claims. `embedEntityId` records the namespace
       * the embed must use verbatim (see schema comment) — undefined for
       * message attachments and stripped by removeNullishValues. */
      ...(embeddingResult?.deferred === true
        ? {
            embeddingStatus: 'pending',
            embedNextAt: new Date(),
            embedAttempts: 0,
            embedEntityId: entity_id,
          }
        : {}),
    }),
    ...retentionExpiry,
  };

  const result = await db.createFile(fileInfo, true);

  res.status(200).json({ message: 'Agent file uploaded and processed successfully', ...result });
};

/**
 * Uploads a source file into a Project: storage + RAG embedding, namespaced
 * by `project_id` so retrieval can filter to the project's sources. The file
 * is persisted with `context: FileContext.project` and `project_id` set.
 *
 * @param {object} params
 * @param {import('express').Request} params.req
 * @param {import('express').Response} params.res
 * @param {{ project_id: string, file_id: string, temp_file_id?: string }} params.metadata
 * @returns {Promise<void>}
 */
const processProjectFileUpload = async ({ req, res, metadata }) => {
  const { file } = req;
  const appConfig = req.config;
  const { project_id, file_id, temp_file_id = null } = metadata;

  if (!project_id) {
    throw new Error('No project ID provided for project file upload');
  }

  if (file.mimetype.startsWith('image')) {
    throw new Error('Image uploads are not supported for project sources');
  }

  const isFileSearchEnabled = await checkCapability(req, AgentCapabilities.file_search);
  if (!isFileSearchEnabled) {
    throw new Error('File search capability is required for project sources');
  }

  const source = getFileStrategy(appConfig, { isImage: false });
  const basePath = 'uploads';
  const entity_id = project_id;

  const { handleFileUpload } = getStrategyFunctions(source);
  const sanitizedUploadFn = createSanitizedUploadWrapper(handleFileUpload);
  const storageResult = await sanitizedUploadFn({
    req,
    file,
    file_id,
    basePath,
    entity_id,
  });

  const { asyncEmbedEnabled } = require('./Embed');
  let embeddingResult;
  if (asyncEmbedEnabled()) {
    embeddingResult = { embedded: false, filename: file.originalname, deferred: true };
  } else {
    const { uploadVectors } = require('./VectorDB/crud');
    try {
      embeddingResult = await uploadVectors({
        req,
        file,
        file_id,
        entity_id,
      });
    } catch (embedError) {
      // Roll back the storage object written just above so a failed embed does
      // not leave an orphan (no DB record is created past this throw).
      await rollbackOrphanedStorage({ req, source, storageResult, file_id });
      throw embedError;
    }
  }

  const {
    bytes,
    filepath: _filepath,
    storageKey: _storageKey,
    storageRegion: _storageRegion,
  } = storageResult;
  const filename = embeddingResult?.filename || storageResult.filename;
  const embedded = embeddingResult?.embedded;

  const storageMetadata = getStorageMetadata({
    filepath: _filepath,
    source,
    storageKey: _storageKey,
    storageRegion: _storageRegion,
  });

  const fileInfo = removeNullishValues({
    user: req.user.id,
    project_id,
    file_id,
    temp_file_id,
    bytes,
    filepath: _filepath,
    ...storageMetadata,
    filename: filename ?? sanitizeFilename(file.originalname),
    context: FileContext.project,
    metadata: {},
    type: file.mimetype,
    embedded,
    source,
    tenantId: req.user.tenantId,
    /* Deferred embedding (RAG_ASYNC_EMBED): project sources embed under
     * entity_id = project_id; the worker reuses it verbatim. */
    ...(embeddingResult?.deferred === true
      ? {
          embeddingStatus: 'pending',
          embedNextAt: new Date(),
          embedAttempts: 0,
          embedEntityId: entity_id,
        }
      : {}),
  });

  const result = await db.createFile(fileInfo, true);

  res.status(200).json({ message: 'Project file uploaded and processed successfully', ...result });
};

/**
 * @param {object} params - The params object.
 * @param {OpenAI} params.openai - The OpenAI client instance.
 * @param {string} params.file_id - The ID of the file to retrieve.
 * @param {string} params.userId - The user ID.
 * @param {string} [params.filename] - The name of the file. `undefined` for `file_citation` annotations.
 * @param {boolean} [params.saveFile=false] - Whether to save the file metadata to the database.
 * @param {boolean} [params.updateUsage=false] - Whether to update file usage in database.
 */
const processOpenAIFile = async ({
  openai,
  file_id,
  userId,
  filename,
  saveFile = false,
  updateUsage = false,
}) => {
  const _file = await openai.files.retrieve(file_id);
  const originalName = filename ?? (_file.filename ? path.basename(_file.filename) : undefined);
  const filepath = `${openai.baseURL}/files/${userId}/${file_id}${
    originalName ? `/${originalName}` : ''
  }`;
  const type = mime.getType(originalName ?? file_id);
  const source =
    openai.req.body.endpoint === EModelEndpoint.azureAssistants
      ? FileSources.azure
      : FileSources.openai;
  const file = {
    ..._file,
    type,
    file_id,
    filepath,
    usage: 1,
    user: userId,
    context: _file.purpose,
    source,
    model: openai.req.body.model,
    filename: originalName ?? file_id,
    ...(await getRetentionExpiry(openai.req)),
    tenantId: openai.req?.user?.tenantId,
  };

  if (saveFile) {
    await db.createFile(file, true);
  } else if (updateUsage) {
    try {
      await db.updateFileUsage({ file_id });
    } catch (error) {
      logger.error('Error updating file usage', error);
    }
  }

  return file;
};

/**
 * Process OpenAI image files, convert to target format, save and return file metadata.
 * @param {object} params - The params object.
 * @param {ServerRequest} params.req - The Express request object.
 * @param {Buffer} params.buffer - The image buffer.
 * @param {string} params.file_id - The file ID.
 * @param {string} params.filename - The filename.
 * @param {string} params.fileExt - The file extension.
 * @returns {Promise<MongoFile>} The file metadata.
 */
const processOpenAIImageOutput = async ({ req, buffer, file_id, filename, fileExt }) => {
  const currentDate = new Date();
  const formattedDate = currentDate.toISOString();
  const appConfig = req.config;
  const _file = await convertImage(req, buffer, undefined, `${file_id}${fileExt}`);

  // Create only one file record with the correct information
  const file = {
    ..._file,
    usage: 1,
    user: req.user.id,
    type: mime.getType(fileExt),
    createdAt: formattedDate,
    updatedAt: formattedDate,
    source: getFileStrategy(appConfig, { isImage: true }),
    context: FileContext.assistants_output,
    file_id,
    filename,
    ...(await getRetentionExpiry(req)),
    tenantId: req.user.tenantId,
  };
  try {
    await db.createFile(file, true);
  } catch (error) {
    logger.warn('Error saving OpenAI image output file metadata', error);
  }
  return file;
};

/**
 * Retrieves and processes an OpenAI file based on its type.
 *
 * @param {Object} params - The params passed to the function.
 * @param {OpenAIClient} params.openai - The OpenAI client instance.
 * @param {RunClient} params.client - The LibreChat client instance: either refers to `openai` or `streamRunManager`.
 * @param {string} params.file_id - The ID of the file to retrieve.
 * @param {string} [params.basename] - The basename of the file (if image); e.g., 'image.jpg'. `undefined` for `file_citation` annotations.
 * @param {boolean} [params.unknownType] - Whether the file type is unknown.
 * @returns {Promise<{file_id: string, filepath: string, source: string, bytes?: number, width?: number, height?: number} | null>}
 * - Returns null if `file_id` is not defined; else, the file metadata if successfully retrieved and processed.
 */
async function retrieveAndProcessFile({
  openai,
  client,
  file_id,
  basename: _basename,
  unknownType,
}) {
  if (!file_id) {
    return null;
  }

  let basename = _basename;
  const processArgs = { openai, file_id, filename: basename, userId: client.req.user.id };

  // If no basename provided, return only the file metadata
  if (!basename) {
    return await processOpenAIFile({ ...processArgs, saveFile: true });
  }

  const fileExt = path.extname(basename);
  if (client.attachedFileIds?.has(file_id) || client.processedFileIds?.has(file_id)) {
    return processOpenAIFile({ ...processArgs, updateUsage: true });
  }

  /**
   * @returns {Promise<Buffer>} The file data buffer.
   */
  const getDataBuffer = async () => {
    const response = await openai.files.content(file_id);
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  };

  let dataBuffer;
  if (unknownType || !fileExt || imageExtRegex.test(basename)) {
    try {
      dataBuffer = await getDataBuffer();
    } catch (error) {
      logger.error('Error downloading file from OpenAI:', error);
      dataBuffer = null;
    }
  }

  if (!dataBuffer) {
    return await processOpenAIFile({ ...processArgs, saveFile: true });
  }

  // If the filetype is unknown, inspect the file
  if (dataBuffer && (unknownType || !fileExt)) {
    const detectedExt = await determineFileType(dataBuffer);
    const isImageOutput = detectedExt && imageExtRegex.test('.' + detectedExt);

    if (!isImageOutput) {
      return await processOpenAIFile({ ...processArgs, saveFile: true });
    }

    return await processOpenAIImageOutput({
      file_id,
      req: client.req,
      buffer: dataBuffer,
      filename: basename,
      fileExt: detectedExt,
    });
  } else if (dataBuffer && imageExtRegex.test(basename)) {
    return await processOpenAIImageOutput({
      file_id,
      req: client.req,
      buffer: dataBuffer,
      filename: basename,
      fileExt,
    });
  } else {
    logger.debug(`[retrieveAndProcessFile] Non-image file type detected: ${basename}`);
    return await processOpenAIFile({ ...processArgs, saveFile: true });
  }
}

/**
 * Converts a base64 string to a buffer.
 * @param {string} base64String
 * @returns {Buffer<ArrayBufferLike>}
 */
function base64ToBuffer(base64String) {
  try {
    const typeMatch = base64String.match(/^data:([A-Za-z-+/]+);base64,/);
    const type = typeMatch ? typeMatch[1] : '';

    const base64Data = base64String.replace(/^data:([A-Za-z-+/]+);base64,/, '');

    if (!base64Data) {
      throw new Error('Invalid base64 string');
    }

    return {
      buffer: Buffer.from(base64Data, 'base64'),
      type,
    };
  } catch (error) {
    throw new Error(`Failed to convert base64 to buffer: ${error.message}`);
  }
}

async function saveBase64Image(
  url,
  { req, file_id: _file_id, filename: _filename, endpoint, context, resolution },
) {
  const appConfig = req.config;
  const effectiveResolution = resolution ?? appConfig.fileConfig?.imageGeneration ?? 'high';
  const file_id = _file_id ?? v4();
  let filename = `${file_id}-${_filename}`;
  const { buffer: inputBuffer, type } = base64ToBuffer(url);
  if (!path.extname(_filename)) {
    const extension = mime.getExtension(type);
    if (extension) {
      filename += `.${extension}`;
    } else {
      throw new Error(`Could not determine file extension from MIME type: ${type}`);
    }
  }

  const image = await resizeImageBuffer(inputBuffer, effectiveResolution, endpoint);
  const source = getFileStrategy(appConfig, { isImage: true });
  const { saveBuffer } = getStrategyFunctions(source);
  const filepath = await saveBuffer({
    userId: req.user.id,
    fileName: filename,
    buffer: image.buffer,
    tenantId: req.user.tenantId,
  });
  const storageMetadata = getStorageMetadata({ filepath, source });
  return await db.createFile(
    {
      type,
      source,
      context,
      file_id,
      filepath,
      ...storageMetadata,
      filename,
      user: req.user.id,
      bytes: image.bytes,
      width: image.width,
      ...(await getRetentionExpiry(req)),
      height: image.height,
      tenantId: req.user.tenantId,
    },
    true,
  );
}

/**
 * Filters a file based on its size and the endpoint origin.
 *
 * @param {Object} params - The parameters for the function.
 * @param {ServerRequest} params.req - The request object from Express.
 * @param {string} [params.req.endpoint]
 * @param {string} [params.req.file_id]
 * @param {number} [params.req.width]
 * @param {number} [params.req.height]
 * @param {number} [params.req.version]
 * @param {boolean} [params.image] - Whether the file expected is an image.
 * @param {boolean} [params.isAvatar] - Whether the file expected is a user or entity avatar.
 * @returns {void}
 *
 * @throws {Error} If a file exception is caught (invalid file size or type, lack of metadata).
 */
function filterFile({ req, image, isAvatar }) {
  const { file } = req;
  const { endpoint, endpointType, file_id, width, height } = req.body;

  if (!file_id && !isAvatar) {
    throw new Error('No file_id provided');
  }

  if (file.size === 0) {
    throw new Error('Empty file uploaded');
  }

  /* parse to validate api call, throws error on fail */
  if (!isAvatar) {
    isUUID.parse(file_id);
  }

  if (!endpoint && !isAvatar) {
    throw new Error('No endpoint provided');
  }

  const appConfig = req.config;
  const fileConfig = mergeFileConfig(appConfig.fileConfig);

  const endpointFileConfig = getEndpointFileConfig({
    endpoint,
    fileConfig,
    endpointType,
  });
  const fileSizeLimit =
    isAvatar === true ? fileConfig.avatarSizeLimit : endpointFileConfig.fileSizeLimit;

  if (file.size > fileSizeLimit) {
    throw new Error(
      `File size limit of ${fileSizeLimit / megabyte} MB exceeded for ${
        isAvatar ? 'avatar upload' : `${endpoint} endpoint`
      }`,
    );
  }

  const isSupportedMimeType = fileConfig.checkType(
    file.mimetype,
    endpointFileConfig.supportedMimeTypes,
  );

  if (!isSupportedMimeType) {
    throw new Error('Unsupported file type');
  }

  if (!image || isAvatar === true) {
    return;
  }

  if (!width) {
    throw new Error('No width provided');
  }

  if (!height) {
    throw new Error('No height provided');
  }
}

module.exports = {
  filterFile,
  processFileURL,
  saveBase64Image,
  processImageFile,
  uploadImageBuffer,
  sweepExpiredFiles,
  startExpiredFileSweep,
  processFileUpload,
  processDeleteRequest,
  purgeFilesWithVectors,
  processAgentFileUpload,
  processProjectFileUpload,
  retrieveAndProcessFile,
  resolveLargeDocRouting,
  resolveContentRouting,
  resolveUploadPrivacy,
};
