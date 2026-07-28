jest.mock('~/models', () => ({
  getRoleByName: jest.fn(),
  getAgentApiKeyById: jest.fn(),
  createAgentApiKey: jest.fn(),
  deleteAgentApiKey: jest.fn(),
  listAgentApiKeys: jest.fn(),
}));

jest.mock('~/server/middleware', () => ({
  requireJwtAuth: (req, _res, next) => {
    req.user = { id: 'user-1', role: 'USER' };
    next();
  },
}));

jest.mock('~/server/middleware/auditApiKey', () => (_req, _res, next) => next());

jest.mock('@librechat/api', () => {
  const actual = jest.requireActual('@librechat/api');
  return {
    ...actual,
    createApiKeyHandlers: () => ({
      createApiKey: (_req, res) => res.status(201).json({ created: true }),
      listApiKeys: (_req, res) => res.status(200).json([]),
      getApiKey: (_req, res) => res.status(200).json({}),
      deleteApiKey: (_req, res) => res.status(200).json({ deleted: true }),
    }),
  };
});

const express = require('express');
const request = require('supertest');
const { PermissionTypes, Permissions } = require('librechat-data-provider');

const { getRoleByName } = require('~/models');
const apiKeysRouter = require('./apiKeys');

/**
 * Minting an API key must require REMOTE_AGENTS.CREATE, not just USE — otherwise
 * `interface.remoteAgents.create: false` in librechat.yaml silently allows every
 * employee to issue a long-lived credential that reaches agents outside the UI.
 */
describe('POST /api/keys permission gate', () => {
  let app;

  const withPermissions = (permissions) => {
    getRoleByName.mockResolvedValue({
      permissions: { [PermissionTypes.REMOTE_AGENTS]: permissions },
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/keys', apiKeysRouter);
  });

  it('rejects creation when the role may use remote agents but not create keys', async () => {
    withPermissions({ [Permissions.USE]: true, [Permissions.CREATE]: false });

    const res = await request(app).post('/api/keys').send({ name: 'k' });

    expect(res.status).toBe(403);
  });

  it('allows creation when the role has both USE and CREATE', async () => {
    withPermissions({ [Permissions.USE]: true, [Permissions.CREATE]: true });

    const res = await request(app).post('/api/keys').send({ name: 'k' });

    expect(res.status).toBe(201);
  });

  it('still lists keys with USE alone, so existing keys stay manageable', async () => {
    withPermissions({ [Permissions.USE]: true, [Permissions.CREATE]: false });

    const res = await request(app).get('/api/keys');

    expect(res.status).toBe(200);
  });
});
