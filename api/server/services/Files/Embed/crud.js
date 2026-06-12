const axios = require('axios');
const FormData = require('form-data');
const { logAxiosError, generateShortLivedToken } = require('@librechat/api');
const { getStrategyFunctions } = require('~/server/services/Files/strategies');

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

module.exports = { embedStoredFile, logAxiosError };
