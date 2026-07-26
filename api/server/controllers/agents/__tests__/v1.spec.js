const { duplicateAgent } = require('../v1');
const { getAgent, createAgent, getActions } = require('~/models');
const { nanoid } = require('nanoid');

jest.mock('~/models');
jest.mock('nanoid');
// duplicateAgent now grants owner VIEW/EDIT ACL entries on the duplicate (and
// rolls the agent back if that fails); the ACL layer needs seeded AccessRoles
// and a real DB, both out of scope for this controller-level spec.
jest.mock('~/server/services/PermissionService', () => ({
  ...jest.requireActual('~/server/services/PermissionService'),
  grantPermission: jest.fn().mockResolvedValue({}),
}));

describe('duplicateAgent', () => {
  let req, res;

  beforeEach(() => {
    req = {
      params: { id: 'agent_123' },
      user: { id: '64b0c0ffee0ddf00d5ec1a2b' },
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    jest.clearAllMocks();
  });

  it('should duplicate an agent successfully', async () => {
    const mockAgent = {
      id: 'agent_123',
      name: 'Test Agent',
      description: 'Test Description',
      instructions: 'Test Instructions',
      provider: 'openai',
      model: 'gpt-4',
      tools: ['file_search'],
      actions: [],
      author: 'user_789',
      versions: [{ name: 'Test Agent', version: 1 }],
      __v: 0,
    };

    const mockNewAgent = {
      // duplicateAgent grants owner ACL by the created agent's Mongo _id;
      // grantPermission validates it as an ObjectId.
      _id: '64b0c0ffee0ddf00d5ec1a2c',
      id: 'agent_new_123',
      name: 'Test Agent (1/2/23, 12:34)',
      description: 'Test Description',
      instructions: 'Test Instructions',
      provider: 'openai',
      model: 'gpt-4',
      tools: ['file_search'],
      actions: [],
      author: '64b0c0ffee0ddf00d5ec1a2b',
      versions: [
        {
          name: 'Test Agent (1/2/23, 12:34)',
          description: 'Test Description',
          instructions: 'Test Instructions',
          provider: 'openai',
          model: 'gpt-4',
          tools: ['file_search'],
          actions: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    };

    getAgent.mockResolvedValue(mockAgent);
    getActions.mockResolvedValue([]);
    nanoid.mockReturnValue('new_123');
    createAgent.mockResolvedValue(mockNewAgent);

    await duplicateAgent(req, res);

    expect(getAgent).toHaveBeenCalledWith({ id: 'agent_123' });
    expect(getActions).toHaveBeenCalledWith({ agent_id: 'agent_123' }, true);
    expect(createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'agent_new_123',
        author: '64b0c0ffee0ddf00d5ec1a2b',
        name: expect.stringContaining('Test Agent ('),
        description: 'Test Description',
        instructions: 'Test Instructions',
        provider: 'openai',
        model: 'gpt-4',
        tools: ['file_search'],
        actions: [],
      }),
    );

    expect(createAgent).toHaveBeenCalledWith(
      expect.not.objectContaining({
        versions: expect.anything(),
        __v: expect.anything(),
      }),
    );

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      agent: mockNewAgent,
      actions: [],
    });
  });

  it('should ensure duplicated agent has clean versions array without nested fields', async () => {
    const mockAgent = {
      id: 'agent_123',
      name: 'Test Agent',
      description: 'Test Description',
      versions: [
        {
          name: 'Test Agent',
          versions: [{ name: 'Nested' }],
          __v: 1,
        },
      ],
      __v: 2,
    };

    const mockNewAgent = {
      // duplicateAgent grants owner ACL by the created agent's Mongo _id;
      // grantPermission validates it as an ObjectId.
      _id: '64b0c0ffee0ddf00d5ec1a2c',
      id: 'agent_new_123',
      name: 'Test Agent (1/2/23, 12:34)',
      description: 'Test Description',
      versions: [
        {
          name: 'Test Agent (1/2/23, 12:34)',
          description: 'Test Description',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    };

    getAgent.mockResolvedValue(mockAgent);
    getActions.mockResolvedValue([]);
    nanoid.mockReturnValue('new_123');
    createAgent.mockResolvedValue(mockNewAgent);

    await duplicateAgent(req, res);

    expect(mockNewAgent.versions).toHaveLength(1);

    const firstVersion = mockNewAgent.versions[0];
    expect(firstVersion).not.toHaveProperty('versions');
    expect(firstVersion).not.toHaveProperty('__v');

    expect(mockNewAgent).not.toHaveProperty('__v');

    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('should return 404 if agent not found', async () => {
    getAgent.mockResolvedValue(null);

    await duplicateAgent(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Agent not found',
      status: 'error',
    });
  });

  it('should convert `tool_resources.ocr` to `tool_resources.context`', async () => {
    const mockAgent = {
      id: 'agent_123',
      name: 'Test Agent',
      tool_resources: {
        ocr: { enabled: true, config: 'test' },
        other: { should: 'not be copied' },
      },
    };

    getAgent.mockResolvedValue(mockAgent);
    getActions.mockResolvedValue([]);
    nanoid.mockReturnValue('new_123');
    createAgent.mockResolvedValue({ id: 'agent_new_123' });

    await duplicateAgent(req, res);

    expect(createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        tool_resources: {
          context: { enabled: true, config: 'test' },
        },
      }),
    );
  });

  it('should handle errors gracefully', async () => {
    getAgent.mockRejectedValue(new Error('Database error'));

    await duplicateAgent(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Database error' });
  });
});
