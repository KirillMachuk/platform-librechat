const validateAuthor = require('~/server/middleware/assistants/validateAuthor');
const { encryptMetadata } = require('~/server/services/ActionService');
const { getOpenAIClient } = require('~/server/controllers/assistants/helpers');
const db = require('~/models');
const router = require('./actions');

jest.mock('@librechat/data-schemas', () => ({
  logger: { warn: jest.fn(), error: jest.fn() },
}));
jest.mock('@librechat/api', () => ({
  isActionDomainAllowed: jest.fn(),
  validateActionOAuthMetadata: jest.fn(),
}));
jest.mock('librechat-data-provider', () => ({
  actionDelimiter: '_action_',
  EModelEndpoint: { azureOpenAI: 'azureOpenAI' },
  removeNullishValues: jest.fn((value) => value),
}));
jest.mock('~/server/services/ActionService', () => ({
  legacyDomainEncode: jest.fn(),
  encryptMetadata: jest.fn(),
  domainParser: jest.fn(),
}));
jest.mock('~/server/middleware/assistants/validateAuthor', () => jest.fn());
jest.mock('~/server/controllers/assistants/helpers', () => ({
  getOpenAIClient: jest.fn(),
}));
jest.mock('~/models', () => ({
  getAssistant: jest.fn(),
  getActions: jest.fn(),
  updateAssistantDoc: jest.fn(),
  updateAction: jest.fn(),
  deleteAction: jest.fn(),
}));

describe('assistant action authorization wiring', () => {
  let openai;
  let postAction;
  let deleteAction;

  const buildResponse = () => ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  });

  beforeEach(() => {
    postAction = router.stack.find((layer) => layer.route?.methods?.post).route.stack[0].handle;
    deleteAction = router.stack.find((layer) => layer.route?.methods?.delete).route.stack[0].handle;

    openai = {
      beta: {
        assistants: {
          retrieve: jest.fn(),
          update: jest.fn(),
        },
      },
    };
    getOpenAIClient.mockResolvedValue({ openai });
    validateAuthor.mockRejectedValue(new Error('Forbidden'));
  });

  test('denies action updates before reading or mutating assistant data', async () => {
    const req = {
      user: { id: 'user-a' },
      config: { endpoints: { assistants: { privateAssistants: false } } },
      params: { assistant_id: 'asst-victim' },
      body: {
        functions: [{ type: 'function', function: { name: 'test' } }],
        metadata: { domain: 'https://example.com' },
        endpoint: 'assistants',
        model: 'test-model',
      },
    };
    const res = buildResponse();

    await postAction(req, res);

    expect(validateAuthor).toHaveBeenCalledWith({
      req,
      openai,
      overrideAssistantId: 'asst-victim',
      requireOwnership: true,
    });
    expect(encryptMetadata).not.toHaveBeenCalled();
    expect(db.getAssistant).not.toHaveBeenCalled();
    expect(openai.beta.assistants.update).not.toHaveBeenCalled();
  });

  test('denies action deletion before reading or mutating assistant data', async () => {
    const req = {
      user: { id: 'user-a' },
      config: { endpoints: { assistants: { privateAssistants: false } } },
      params: {
        assistant_id: 'asst-victim',
        action_id: 'action-victim',
        model: 'test-model',
      },
      body: {},
    };
    const res = buildResponse();

    await deleteAction(req, res);

    expect(validateAuthor).toHaveBeenCalledWith({
      req,
      openai,
      overrideAssistantId: 'asst-victim',
      requireOwnership: true,
    });
    expect(db.getAssistant).not.toHaveBeenCalled();
    expect(openai.beta.assistants.update).not.toHaveBeenCalled();
  });
});
