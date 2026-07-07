const express = require('express');
const { logger } = require('@librechat/data-schemas');
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
const auditProject = require('~/server/middleware/auditProject');
const { requireJwtAuth } = require('~/server/middleware');

const router = express.Router();
router.use(requireJwtAuth);

router.get('/', async (req, res) => {
  try {
    const projects = await getProjects(req.user.id);
    res.status(200).json(projects);
  } catch (error) {
    logger.error('[GET /projects] Error', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', auditProject, async (req, res) => {
  try {
    const { name, description, instructions, icon, color } = req.body ?? {};
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Project name is required' });
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
    const files = await getFiles({ user: req.user.id, project_id: req.params.projectId });

    const deleted = await deleteProject(req.user.id, req.params.projectId);
    if (!deleted) {
      return res.status(404).json({ error: 'Project not found' });
    }

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
