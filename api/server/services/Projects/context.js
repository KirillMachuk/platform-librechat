const { CacheKeys } = require('librechat-data-provider');
const { logger } = require('@librechat/data-schemas');
const getLogStores = require('~/cache/getLogStores');
const db = require('~/models');

/**
 * @typedef {object} ProjectChatContext
 * @property {string} instructions - Trimmed project instructions ('' when none).
 * @property {string[]} fileIds - Embedded (RAG) file ids of the project.
 */

const cacheKey = (user, projectId) => `${user}:${projectId}`;

/**
 * Loads the per-(user, project) chat context — instructions + embedded file ids —
 * through a short-TTL cache. applyProjectContext runs on EVERY message turn, so
 * without this each turn costs two Mongo queries per user; with ~100 active users
 * that is thousands of queries/minute for data that changes rarely. Mutations
 * invalidate via {@link invalidateProjectContext}, and the 30s TTL bounds staleness
 * for anything missed.
 *
 * @param {string} user
 * @param {string} projectId
 * @returns {Promise<ProjectChatContext | null>} null when the project does not
 *   exist or does not belong to the user.
 */
async function getProjectContext(user, projectId) {
  const cache = getLogStores(CacheKeys.PROJECT_CONTEXT);
  const key = cacheKey(user, projectId);

  try {
    const cached = await cache.get(key);
    if (cached !== undefined && cached !== null) {
      return cached.missing ? null : cached;
    }
  } catch (error) {
    logger.warn('[getProjectContext] cache read failed; falling back to Mongo', error);
  }

  const project = await db.getProjectById(user, projectId);
  if (!project) {
    try {
      await cache.set(key, { missing: true });
    } catch {
      /* cache write is best-effort */
    }
    return null;
  }

  const projectFiles = await db.getFiles({ user, project_id: projectId, embedded: true }, null, {
    text: 0,
    fullText: 0,
  });

  /** @type {ProjectChatContext} */
  const context = {
    instructions: (project.instructions ?? '').trim(),
    fileIds: projectFiles.map((f) => f.file_id).filter(Boolean),
  };

  try {
    await cache.set(key, context);
  } catch (error) {
    logger.warn('[getProjectContext] cache write failed', error);
  }
  return context;
}

/**
 * Drops the cached chat context for a (user, project). Call after any mutation
 * that changes what a chat turn should see: project update/delete, project file
 * upload/delete.
 *
 * @param {string} user
 * @param {string} projectId
 * @returns {Promise<void>}
 */
async function invalidateProjectContext(user, projectId) {
  try {
    await getLogStores(CacheKeys.PROJECT_CONTEXT).delete(cacheKey(user, projectId));
  } catch (error) {
    logger.warn('[invalidateProjectContext] cache delete failed', error);
  }
}

module.exports = { getProjectContext, invalidateProjectContext };
