const express = require('express');
const { logger } = require('@librechat/data-schemas');
const { Constants } = require('librechat-data-provider');
const {
  createProject,
  getProjectById,
  getProjects,
  getFiles,
  updateProject,
  deleteProject,
  getConvosByCursor,
} = require('~/models');
const { purgeFilesWithVectors } = require('~/server/services/Files/process');
const { invalidateProjectContext } = require('~/server/services/Projects/context');
const auditProject = require('~/server/middleware/auditProject');
const { requireJwtAuth, projectCreateLimiter } = require('~/server/middleware');

const router = express.Router();
router.use(requireJwtAuth);

const PROJECT_FIELD_LIMITS = {
  name: Constants.PROJECT_NAME_MAX_LENGTH,
  description: Constants.PROJECT_DESCRIPTION_MAX_LENGTH,
  instructions: Constants.PROJECT_INSTRUCTIONS_MAX_LENGTH,
  icon: Constants.PROJECT_ICON_MAX_LENGTH,
  color: Constants.PROJECT_COLOR_MAX_LENGTH,
};

/**
 * Server-side length guard for project text fields. The client caps these, but a
 * direct API call bypasses that — unbounded `instructions` bloats Mongo docs and
 * is injected verbatim into agent instructions. Returns an error string, or null.
 * @param {Record<string, unknown>} body
 * @returns {string | null}
 */
const validateProjectFieldLengths = (body) => {
  for (const [field, limit] of Object.entries(PROJECT_FIELD_LIMITS)) {
    const value = body?.[field];
    if (typeof value === 'string' && value.length > limit) {
      return `Project ${field} cannot exceed ${limit} characters`;
    }
  }
  return null;
};

router.get('/', async (req, res) => {
  try {
    const projects = await getProjects(req.user.id);
    res.status(200).json(projects);
  } catch (error) {
    logger.error('[GET /projects] Error', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', projectCreateLimiter, auditProject, async (req, res) => {
  try {
    const { name, description, instructions, icon, color } = req.body ?? {};
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Project name is required' });
    }
    const lengthError = validateProjectFieldLengths(req.body);
    if (lengthError) {
      return res.status(400).json({ error: lengthError });
    }
    const project = await createProject(req.user.id, {
      name: name.trim(),
      description: typeof description === 'string' ? description : '',
      instructions: typeof instructions === 'string' ? instructions : '',
      icon: typeof icon === 'string' ? icon : undefined,
      color: typeof color === 'string' ? color : undefined,
    });
    res.status(201).json(project);
  } catch (error) {
    logger.error('[POST /projects] Error', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:projectId', async (req, res) => {
  try {
    const project = await getProjectById(req.user.id, req.params.projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    res.status(200).json(project);
  } catch (error) {
    logger.error('[GET /projects/:projectId] Error', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/:projectId', auditProject, async (req, res) => {
  try {
    const { name, description, instructions, icon, color } = req.body ?? {};
    const lengthError = validateProjectFieldLengths(req.body);
    if (lengthError) {
      return res.status(400).json({ error: lengthError });
    }
    const update = {};
    if (typeof name === 'string') update.name = name.trim();
    if (typeof description === 'string') update.description = description;
    if (typeof instructions === 'string') update.instructions = instructions;
    if (typeof icon === 'string') update.icon = icon;
    if (typeof color === 'string') update.color = color;
    const project = await updateProject(req.user.id, req.params.projectId, update);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    await invalidateProjectContext(req.user.id, req.params.projectId);
    res.status(200).json(project);
  } catch (error) {
    logger.error('[PATCH /projects/:projectId] Error', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:projectId', auditProject, async (req, res) => {
  try {
    // Collect the project's files before deleting the project doc — deleteProject
    // detaches conversations but leaves File records (and their pgvector
    // embeddings) behind, orphaning them until the global retention sweep.
    // getFiles' default projection already drops the large `text`/`previewText`
    // blobs, so this loads metadata only.
    const files = await getFiles({ user: req.user.id, project_id: req.params.projectId });

    const deleted = await deleteProject(req.user.id, req.params.projectId);
    if (!deleted) {
      return res.status(404).json({ error: 'Project not found' });
    }
    await invalidateProjectContext(req.user.id, req.params.projectId);

    // DELETE carries no body; give processDeleteRequest an object to read.
    req.body = req.body ?? {};
    try {
      await purgeFilesWithVectors({ req, files });
    } catch (cascadeError) {
      // The project doc is already gone — report success and leave the
      // stragglers to the retention sweep rather than faking a failed delete.
      logger.error('[DELETE /projects/:projectId] File cascade failed', cascadeError);
    }

    res.status(204).end();
  } catch (error) {
    logger.error('[DELETE /projects/:projectId] Error', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:projectId/conversations', async (req, res) => {
  try {
    const project = await getProjectById(req.user.id, req.params.projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const { cursor, limit, sortBy, sortDirection } = req.query;
    const result = await getConvosByCursor(req.user.id, {
      cursor: cursor || null,
      limit: limit ? Number(limit) : 25,
      sortBy: typeof sortBy === 'string' ? sortBy : 'updatedAt',
      sortDirection: sortDirection === 'asc' ? 'asc' : 'desc',
      projectId: req.params.projectId,
    });
    res.status(200).json(result);
  } catch (error) {
    logger.error('[GET /projects/:projectId/conversations] Error', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
