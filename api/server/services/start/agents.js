const path = require('path');
const { logger } = require('@librechat/data-schemas');
const {
  AccessRoleIds,
  ResourceType,
  PrincipalType,
  PrincipalModel,
} = require('librechat-data-provider');
const { loadAgentDefinitions, provisionAgents, summarise } = require('@librechat/api');
const { grantPermission } = require('~/server/services/PermissionService');
const { getAgent, createAgent, updateAgent, findUser } = require('~/models');

/**
 * Reconciles file-defined agents into the database at boot.
 *
 * Thin wrapper: every rule lives in `@librechat/api` (parsing, diffing, idempotency); this
 * file only supplies the real database and permission functions and resolves the author,
 * which the schema requires and which cannot be known from a file.
 */

/**
 * Resolves the account provisioned agents are authored by. Prefers an explicitly
 * configured email so ownership is deliberate rather than "whoever registered first";
 * falls back to the oldest ADMIN so a stand that never set the variable still works.
 */
async function resolveAuthor() {
  const configured = process.env.AGENT_PROVISION_AUTHOR_EMAIL?.trim();
  if (configured) {
    const user = await findUser({ email: configured }, '_id email');
    if (!user) {
      throw new Error(
        `AGENT_PROVISION_AUTHOR_EMAIL=${configured} — пользователь с таким адресом не найден`,
      );
    }
    return user._id;
  }
  const admin = await findUser({ role: 'ADMIN' }, '_id email');
  if (!admin) {
    throw new Error(
      'некому назначить владельцем агентов: задайте AGENT_PROVISION_AUTHOR_EMAIL или заведите администратора',
    );
  }
  return admin._id;
}

/**
 * Runs one reconcile pass. Never throws: a stand must start even when a definition file is
 * broken, because the alternative is a platform that refuses to boot over a typo in an
 * agent prompt. Problems are logged as errors so they surface in the deploy check.
 */
async function initializeProvisionedAgents({ projectRoot } = {}) {
  const root = projectRoot ?? path.resolve(__dirname, '../../../..');
  const { directory, definitions, errors } = await loadAgentDefinitions({ projectRoot: root });

  for (const error of errors) {
    logger.error(`[provisionAgents] ${error}`);
  }
  if (definitions.length === 0) {
    logger.debug(`[provisionAgents] нечего применять (${directory})`);
    return { outcomes: [], errors };
  }

  let authorId;
  try {
    authorId = await resolveAuthor();
  } catch (error) {
    logger.error(`[provisionAgents] ${error.message}`);
    return { outcomes: [], errors: [...errors, error.message] };
  }

  const outcomes = await provisionAgents(definitions, {
    authorId,
    getAgent,
    createAgent,
    updateAgent,
    grantPublicView: async (resourceId, grantedBy) => {
      await grantPermission({
        principalType: PrincipalType.PUBLIC,
        principalId: null,
        principalModel: PrincipalModel.USER,
        resourceType: ResourceType.AGENT,
        resourceId,
        accessRoleId: AccessRoleIds.AGENT_VIEWER,
        grantedBy,
      });
    },
  });

  logger.info(`[provisionAgents] ${directory}: ${summarise(outcomes)}`);
  for (const outcome of outcomes) {
    if (outcome.action === 'failed') {
      logger.error(`[provisionAgents] «${outcome.id}» не применён: ${outcome.error}`);
    }
  }
  return { outcomes, errors };
}

module.exports = { initializeProvisionedAgents };
