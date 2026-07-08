const createAuditOnFinish = require('./auditOnFinish');

/**
 * Records project CRUD and project-file mutations under /api/projects:
 * `project.create` / `project.update` / `project.delete` on the project routes,
 * `project.file.upload` / `project.file.delete` on the nested files routes
 * (distinguished by `req.params.file_id` / the merged `projectId` param).
 *
 * Only metadata is captured — never `instructions` or file contents (PII).
 */
module.exports = createAuditOnFinish((req) => {
  const projectId = req.params?.projectId;
  const name = typeof req.body?.name === 'string' ? req.body.name : undefined;

  if (req.method === 'DELETE' && req.params?.file_id) {
    return {
      action: 'project.file.delete',
      targetType: 'file',
      targetId: req.params.file_id,
      metadata: { projectId: projectId ?? '' },
    };
  }
  if (req.method === 'POST' && projectId) {
    return {
      action: 'project.file.upload',
      targetType: 'file',
      targetId: typeof req.body?.file_id === 'string' ? req.body.file_id : undefined,
      metadata: {
        projectId,
        filename: typeof req.file?.originalname === 'string' ? req.file.originalname : '',
        size: typeof req.file?.size === 'number' ? req.file.size : 0,
      },
    };
  }
  if (req.method === 'POST') {
    return {
      action: 'project.create',
      targetType: 'project',
      metadata: name ? { name } : {},
    };
  }
  if (req.method === 'PATCH') {
    return {
      action: 'project.update',
      targetType: 'project',
      targetId: projectId,
      metadata: name ? { name } : {},
    };
  }
  if (req.method === 'DELETE') {
    return {
      action: 'project.delete',
      targetType: 'project',
      targetId: projectId,
    };
  }
  return null;
});
