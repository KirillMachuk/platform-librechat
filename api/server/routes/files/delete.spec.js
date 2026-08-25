/**
 * What DELETE /files answers when the delete did not fully land.
 *
 * A file whose vector cleanup failed keeps its record on purpose, so its text cannot stay
 * searchable with nothing left to link it to an owner. The route used to answer "Files deleted
 * successfully" regardless: the file vanished from the list and came back on the next refresh,
 * its bytes already gone, with nothing said.
 */

jest.mock('@librechat/data-schemas', () => ({
  logger: { warn: jest.fn(), debug: jest.fn(), error: jest.fn(), info: jest.fn() },
  SystemCapabilities: {},
}));

jest.mock('@librechat/api', () => ({
  logAxiosError: jest.fn(),
  refreshS3FileUrls: jest.fn(),
  resolveUploadErrorMessage: jest.fn(),
  verifyAgentUploadPermission: jest.fn(),
  isOfficeHtmlPreviewable: jest.fn(() => false),
  isCurrentOfficePreview: jest.fn(() => true),
  renderOfficePreview: jest.fn(),
  MAX_OFFICE_PREVIEW_BYTES: 25 * 1024 * 1024,
}));

const mockProcessDeleteRequest = jest.fn();
const mockFindFileById = jest.fn();
const mockGetFiles = jest.fn();
const mockUpdateFile = jest.fn();
const mockGetAgents = jest.fn().mockResolvedValue([]);
jest.mock('~/models', () => ({
  findFileById: (...args) => mockFindFileById(...args),
  getFiles: (...args) => mockGetFiles(...args),
  updateFile: (...args) => mockUpdateFile(...args),
  getAgents: (...args) => mockGetAgents(...args),
  batchUpdateFiles: jest.fn(),
}));

jest.mock('~/server/services/Files/process', () => ({
  filterFile: jest.fn(),
  processFileUpload: jest.fn(),
  processDeleteRequest: (...args) => mockProcessDeleteRequest(...args),
  processAgentFileUpload: jest.fn(),
}));

jest.mock('~/server/services/Files/strategies', () => ({
  getStrategyFunctions: jest.fn(() => ({})),
}));

jest.mock('~/server/controllers/assistants/helpers', () => ({
  getOpenAIClient: jest.fn(),
}));

jest.mock('~/server/middleware/roles/capabilities', () => ({
  hasCapability: jest.fn(() => (_req, _res, next) => next()),
}));

jest.mock('~/server/services/PermissionService', () => ({
  checkPermission: jest.fn(() => (_req, _res, next) => next()),
  getEffectivePermissions: jest.fn().mockResolvedValue(0),
}));

jest.mock('~/server/services/Files', () => ({
  hasAccessToFilesViaAgent: jest.fn(),
}));

jest.mock('~/server/utils/files', () => ({
  cleanFileName: (name) => name,
  getContentDisposition: (name) => `attachment; filename="${name}"`,
}));

jest.mock('~/cache', () => ({
  getLogStores: jest.fn(() => ({ get: jest.fn(), set: jest.fn() })),
}));

const express = require('express');
const request = require('supertest');
const filesRouter = require('./files');

/**
 * Mount the router with a per-request user injector so we can simulate
 * a logged-in user without spinning up the full auth stack.
 */
function buildApp({ user = { id: 'user-123', role: 'user' } } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    req.config = { fileStrategy: 'local' };
    next();
  });
  app.use('/files', filesRouter);
  return app;
}

const OWNER = 'user-123';
/* The route only accepts UUID (or file-/assistant- prefixed) ids and answers 204 to anything
 * else, so a made-up id would never reach the handler under test. */
const KEPT = '11111111-1111-4111-8111-111111111111';
const GONE = '22222222-2222-4222-8222-222222222222';
const ownedFile = (file_id) => ({
  file_id,
  user: OWNER,
  filename: `${file_id}.pdf`,
  filepath: `/uploads/${OWNER}/${file_id}.pdf`,
  source: 'local',
  embedded: true,
});

describe('DELETE /files when the delete could not finish', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetFiles.mockReset();
    mockProcessDeleteRequest.mockReset();
  });

  const del = (file_ids) =>
    request(buildApp())
      .delete('/files')
      .send({ files: file_ids.map((id) => ({ file_id: id, filepath: `/uploads/${id}` })) });

  it('answers with success only when every file actually went', async () => {
    mockGetFiles.mockResolvedValue([ownedFile(GONE), ownedFile(KEPT)]);
    mockProcessDeleteRequest.mockResolvedValue({
      deletedFileIds: [GONE, KEPT],
      failedFileIds: [],
    });

    const res = await del([GONE, KEPT]);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ message: 'Files deleted successfully' });
  });

  it('reports the files it kept instead of claiming they were deleted', async () => {
    mockGetFiles.mockResolvedValue([ownedFile(GONE), ownedFile(KEPT)]);
    mockProcessDeleteRequest.mockResolvedValue({
      deletedFileIds: [GONE],
      failedFileIds: [KEPT],
    });

    const res = await del([GONE, KEPT]);

    expect(res.status).not.toBe(200);
    expect(res.body.failedFileIds).toEqual([KEPT]);
    /* The text has to name the next step: the file is still there on purpose, and retrying is
     * what clears it once the vector store answers again. */
    expect(res.body.message).toMatch(/again/i);
  });
});
