const fs = require('fs').promises;
const express = require('express');
const { v4 } = require('uuid');
const { logger } = require('@librechat/data-schemas');
const { resolveUploadErrorMessage } = require('@librechat/api');
const { EModelEndpoint } = require('librechat-data-provider');
const {
  filterFile,
  processProjectFileUpload,
  purgeFilesWithVectors,
} = require('~/server/services/Files/process');
const { invalidateProjectContext } = require('~/server/services/Projects/context');
const auditProject = require('~/server/middleware/auditProject');
const db = require('~/models');

const router = express.Router({ mergeParams: true });

router.get('/', async (req, res) => {
  try {
    const project = await db.getProjectById(req.user.id, req.params.projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const files = await db.getFiles({ user: req.user.id, project_id: req.params.projectId }, null, {
      text: 0,
      fullText: 0,
    });
    res.status(200).json(files);
  } catch (error) {
    logger.error('[GET /projects/:projectId/files] Error', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', auditProject, async (req, res) => {
  let cleanup = true;
  try {
    const project = await db.getProjectById(req.user.id, req.params.projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Project uploads aren't endpoint-scoped, but filterFile requires `endpoint`
    // for MIME/size resolution. Default to `agents` so file-config resolution
    // falls back through the `agents` branch to the global `default` block.
    req.body.endpoint = req.body.endpoint || EModelEndpoint.agents;

    filterFile({ req });

    const metadata = {
      project_id: req.params.projectId,
      file_id: req.file_id ?? v4(),
      temp_file_id: req.body?.file_id ?? undefined,
    };

    const uploadResult = await processProjectFileUpload({ req, res, metadata });
    await invalidateProjectContext(req.user.id, req.params.projectId);
    return uploadResult;
  } catch (error) {
    const message = resolveUploadErrorMessage(error);
    logger.error('[POST /projects/:projectId/files] Error', error);
    if (req.file?.path) {
      try {
        await fs.unlink(req.file.path);
        cleanup = false;
      } catch (cleanupErr) {
        logger.error('[POST /projects/:projectId/files] Cleanup error', cleanupErr);
      }
    }
    res.status(500).json({ message });
  } finally {
    if (cleanup && req.file?.path) {
      try {
        await fs.unlink(req.file.path);
      } catch (error) {
        logger.error('[POST /projects/:projectId/files] Trailing cleanup error', error);
      }
    }
  }
});

router.delete('/:file_id', auditProject, async (req, res) => {
  try {
    const project = await db.getProjectById(req.user.id, req.params.projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const files = await db.getFiles({
      user: req.user.id,
      project_id: req.params.projectId,
      file_id: req.params.file_id,
    });
    if (!files || files.length === 0) {
      return res.status(404).json({ error: 'File not found in project' });
    }

    // Express body parser leaves req.body undefined for DELETE without a body
    // (axios.delete sends no Content-Type). processDeleteRequest dereferences
    // req.body.assistant_id and would throw; give it an empty body to read.
    req.body = req.body ?? {};

    // Project sources are dual-stored (storage + pgvector); purge both, including
    // the vector embeddings the local delete strategy would otherwise orphan.
    await purgeFilesWithVectors({ req, files });
    await invalidateProjectContext(req.user.id, req.params.projectId);
    res.status(204).end();
  } catch (error) {
    logger.error('[DELETE /projects/:projectId/files/:file_id] Error', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
