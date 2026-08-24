const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const { logger } = require('@librechat/data-schemas');
const { FileSources } = require('librechat-data-provider');
const { logAxiosError, generateShortLivedToken } = require('@librechat/api');

/**
 * Whether the file could own chunks in the vector store.
 *
 * `embedded: true` is the committed case, but not the only one. Under
 * `RAG_ASYNC_EMBED` the record is written before the embed runs, and an attempt
 * that timed out on our side never proved the doc-gateway committed nothing —
 * which is why a retry purges before re-embedding (see the embed worker). So a
 * record still sitting at 'pending', 'processing' or 'failed' can own chunks it
 * was never credited for, and deleting it without asking the vector store
 * leaves the document's text behind with nothing left to link it to its owner.
 *
 * @param {MongoFile} file
 * @returns {boolean}
 */
const mayHaveVectors = (file) => file?.embedded === true || file?.embeddingStatus != null;

/** Ceiling for the delete call, same as the background purge carries. */
const DELETE_TIMEOUT_MS = 60_000;

/**
 * Deletes a file from the vector database. This function takes a file object, constructs the full path, and
 * verifies the path's validity before deleting the file. If the path is invalid, an error is thrown.
 *
 * @param {ServerRequest} req - The request object from Express.
 * @param {MongoFile} file - The file object to be deleted. It should have a `filepath` property that is
 *                           a string representing the path of the file relative to the publicPath.
 *
 * @returns {Promise<void>}
 *          A promise that resolves when the file has been successfully deleted, or throws an error if the
 *          file path is invalid or if there is an error in deletion.
 */
const deleteVectors = async (req, file) => {
  if (!mayHaveVectors(file)) {
    return;
  }
  if (!process.env.RAG_API_URL) {
    /* Say it out loud rather than counting the file as fully deleted: without a vector store
     * configured there is nothing to ask, but the chunks of a file that WAS embedded do not
     * disappear because the URL did. Refusing the delete would strand every file on a contour
     * that never had RAG, so this stays a warning naming the file instead. */
    logger.warn(
      `Vector cleanup skipped for ${file.file_id}: RAG_API_URL is not set, any embeddings it owns stay behind`,
    );
    return;
  }
  try {
    const jwtToken = generateShortLivedToken(req.user.id);

    return await axios.delete(`${process.env.RAG_API_URL}/documents`, {
      headers: {
        Authorization: `Bearer ${jwtToken}`,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      data: [file.file_id],
      /* A hung vector store must not hang the user's delete forever. Mirrors the
       * background purge, which has always carried a ceiling. */
      timeout: DELETE_TIMEOUT_MS,
    });
  } catch (error) {
    logAxiosError({
      error,
      message: 'Error deleting vectors',
    });
    if (error.response?.status === 404) {
      return;
    }
    /* Everything else keeps the file: a refused connection, a timeout or a DNS
     * failure carries no `error.response` at all, and reading that as success is
     * how the text of a deleted document ends up in the index with no record left
     * to link it to its owner. While the record lives the delete can be retried. */
    logger.warn(
      `Error deleting vectors for ${file.file_id}, its file record will be kept so the delete can be retried`,
    );
    throw new Error(error.message || 'An error occurred during file deletion.');
  }
};

/**
 * Uploads a file to the configured Vector database
 *
 * @param {Object} params - The params object.
 * @param {Object} params.req - The request object from Express. It should have a `user` property with an `id` representing the user
 * @param {Express.Multer.File} params.file - The file object, which is part of the request. The file object should
 *                                     have a `path` property that points to the location of the uploaded file.
 * @param {string} params.file_id - The file ID.
 * @param {string} [params.entity_id] - The entity ID for shared resources.
 * @param {Object} [params.storageMetadata] - Storage metadata for dual storage pattern.
 *
 * @returns {Promise<{ filepath: string, bytes: number }>}
 *          A promise that resolves to an object containing:
 *            - filepath: The path where the file is saved.
 *            - bytes: The size of the file in bytes.
 */
async function uploadVectors({ req, file, file_id, entity_id, storageMetadata }) {
  if (!process.env.RAG_API_URL) {
    throw new Error('RAG_API_URL not defined');
  }

  try {
    const jwtToken = generateShortLivedToken(req.user.id);
    const formData = new FormData();
    formData.append('file_id', file_id);
    formData.append('file', fs.createReadStream(file.path));
    if (entity_id != null && entity_id) {
      formData.append('entity_id', entity_id);
    }

    // Include storage metadata for RAG API to store with embeddings
    if (storageMetadata) {
      formData.append('storage_metadata', JSON.stringify(storageMetadata));
    }

    const formHeaders = formData.getHeaders();

    const response = await axios.post(`${process.env.RAG_API_URL}/embed`, formData, {
      headers: {
        Authorization: `Bearer ${jwtToken}`,
        accept: 'application/json',
        ...formHeaders,
      },
    });

    const responseData = response.data;
    logger.debug('Response from embedding file', responseData);

    if (responseData.known_type === false) {
      throw new Error(`File embedding failed. The filetype ${file.mimetype} is not supported`);
    }

    if (!responseData.status) {
      throw new Error('File embedding failed.');
    }

    return {
      bytes: file.size,
      filename: file.originalname,
      filepath: FileSources.vectordb,
      embedded: Boolean(responseData.known_type),
    };
  } catch (error) {
    logAxiosError({
      error,
      message: 'Error uploading vectors',
    });
    throw new Error(error.message || 'An error occurred during file upload.');
  }
}

module.exports = {
  mayHaveVectors,
  deleteVectors,
  uploadVectors,
};
