const validateAuthor = require('~/server/middleware/assistants/validateAuthor');
const { getOpenAIClient } = require('./helpers');
const controllers = require('./v1');

jest.mock('fs', () => ({ promises: {} }));
jest.mock('@librechat/data-schemas', () => ({
  logger: { debug: jest.fn(), error: jest.fn() },
}));
jest.mock('librechat-data-provider', () => ({ FileContext: { avatar: 'avatar' } }));
jest.mock('~/models', () => ({
  deleteFileByFilter: jest.fn(),
  updateAssistantDoc: jest.fn(),
  getAssistants: jest.fn(),
}));
jest.mock('~/server/services/Files/process', () => ({
  uploadImageBuffer: jest.fn(),
  filterFile: jest.fn(),
}));
jest.mock('~/server/middleware/assistants/validateAuthor', () => jest.fn());
jest.mock('~/server/services/Files/strategies', () => ({ getStrategyFunctions: jest.fn() }));
jest.mock('~/server/services/ActionService', () => ({ deleteAssistantActions: jest.fn() }));
jest.mock('./helpers', () => ({
  getOpenAIClient: jest.fn(),
  fetchAssistants: jest.fn(),
}));
jest.mock('~/server/services/Config', () => ({ getCachedTools: jest.fn() }));
jest.mock('~/app/clients/tools', () => ({ manifestToolMap: {} }));

const buildResponse = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
});

describe('assistant controller authorization wiring', () => {
  let openai;

  beforeEach(() => {
    openai = {
      beta: {
        assistants: {
          retrieve: jest.fn().mockResolvedValue({ id: 'asst-victim' }),
          update: jest.fn(),
        },
      },
    };
    getOpenAIClient.mockResolvedValue({ openai });
    validateAuthor.mockResolvedValue();
  });

  test('validates private read access before retrieving an assistant', async () => {
    const req = { params: { id: 'asst-victim' }, body: {}, query: {} };
    const res = buildResponse();

    await controllers.retrieveAssistant(req, res);

    expect(validateAuthor).toHaveBeenCalledWith({ req, openai });
    expect(validateAuthor.mock.invocationCallOrder[0]).toBeLessThan(
      openai.beta.assistants.retrieve.mock.invocationCallOrder[0],
    );
  });

  test('requires ownership before updating a shared assistant', async () => {
    const req = {
      params: { id: 'asst-victim' },
      body: { endpoint: 'assistants', tools: [] },
      query: {},
    };
    const res = buildResponse();
    validateAuthor.mockRejectedValue(new Error('Forbidden'));

    await controllers.patchAssistant(req, res);

    expect(validateAuthor).toHaveBeenCalledWith({ req, openai, requireOwnership: true });
    expect(openai.beta.assistants.update).not.toHaveBeenCalled();
  });
});
