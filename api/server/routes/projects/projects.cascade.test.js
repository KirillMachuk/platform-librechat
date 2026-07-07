jest.mock('~/models', () => ({
  createProject: jest.fn(),
  getProjectById: jest.fn(),
  getProjects: jest.fn(),
  getFiles: jest.fn(),
  updateProject: jest.fn(),
  deleteProject: jest.fn(),
  getConvosByCursor: jest.fn(),
}));

jest.mock('~/server/middleware', () => ({
  requireJwtAuth: (req, _res, next) => {
    req.user = { id: 'user-1' };
    next();
  },
}));

jest.mock('~/server/services/Files/process', () => ({
  purgeFilesWithVectors: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const { purgeFilesWithVectors } = require('~/server/services/Files/process');
const { getFiles, deleteProject } = require('~/models');
const projectsRouter = require('./projects');

describe('DELETE /projects/:projectId file cascade (C-PRJ-1)', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/projects', projectsRouter);
  });

  it('purges the project files (storage + vectors) after deleting the project', async () => {
    const files = [
      { file_id: 'f1', embedded: true },
      { file_id: 'f2', embedded: false },
    ];
    getFiles.mockResolvedValue(files);
    deleteProject.mockResolvedValue(true);
    purgeFilesWithVectors.mockResolvedValue(undefined);

    const res = await request(app).delete('/projects/p1');

    expect(res.status).toBe(204);
    expect(getFiles).toHaveBeenCalledWith({ user: 'user-1', project_id: 'p1' });
    expect(deleteProject).toHaveBeenCalledWith('user-1', 'p1');
    expect(purgeFilesWithVectors).toHaveBeenCalledWith(
      expect.objectContaining({ files }),
    );
  });

  it('does not touch files when the project is not found (404)', async () => {
    getFiles.mockResolvedValue([{ file_id: 'f1', embedded: true }]);
    deleteProject.mockResolvedValue(false);

    const res = await request(app).delete('/projects/missing');

    expect(res.status).toBe(404);
    expect(purgeFilesWithVectors).not.toHaveBeenCalled();
  });

  it('still returns 204 when the file cascade fails after the project doc is gone', async () => {
    getFiles.mockResolvedValue([{ file_id: 'f1', embedded: true }]);
    deleteProject.mockResolvedValue(true);
    purgeFilesWithVectors.mockRejectedValue(new Error('pgvector down'));

    const res = await request(app).delete('/projects/p1');

    expect(res.status).toBe(204);
  });
});
