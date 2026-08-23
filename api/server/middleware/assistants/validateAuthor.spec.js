const { hasCapability } = require('~/server/middleware/roles/capabilities');
const { getAssistant } = require('~/models');
const validateAuthor = require('./validateAuthor');

jest.mock('@librechat/data-schemas', () => ({
  logger: { warn: jest.fn(), debug: jest.fn() },
  SystemCapabilities: { MANAGE_ASSISTANTS: 'MANAGE_ASSISTANTS' },
}));
jest.mock('~/server/middleware/roles/capabilities', () => ({
  hasCapability: jest.fn(),
}));
jest.mock('~/models', () => ({
  getAssistant: jest.fn(),
}));

const buildRequest = ({ privateAssistants = false, params = {}, body = {}, query = {} } = {}) => ({
  user: { id: 'user-a' },
  config: { endpoints: { assistants: { privateAssistants } } },
  params,
  body: { endpoint: 'assistants', ...body },
  query,
});

const buildOpenAI = (author = 'user-b') => ({
  beta: {
    assistants: {
      retrieve: jest.fn().mockResolvedValue({ metadata: { author } }),
    },
  },
});

describe('validateAuthor', () => {
  beforeEach(() => {
    hasCapability.mockResolvedValue(false);
    getAssistant.mockResolvedValue(null);
  });

  test('allows ordinary use of a shared assistant', async () => {
    const req = buildRequest({ params: { id: 'asst-shared' } });
    const openai = buildOpenAI();

    await expect(validateAuthor({ req, openai })).resolves.toBeUndefined();
    expect(getAssistant).not.toHaveBeenCalled();
    expect(openai.beta.assistants.retrieve).not.toHaveBeenCalled();
  });

  test('requires ownership for mutations even when the assistant is shared', async () => {
    const req = buildRequest({ params: { id: 'asst-shared' } });
    const openai = buildOpenAI('user-b');

    await expect(validateAuthor({ req, openai, requireOwnership: true })).rejects.toThrow(
      'Assistant asst-shared is not authored by the user.',
    );
    expect(getAssistant).toHaveBeenCalledWith({ assistant_id: 'asst-shared', user: 'user-a' });
  });

  test('reads assistant_id route params for avatar and action mutations', async () => {
    const req = buildRequest({ params: { assistant_id: 'asst-param' } });
    const openai = buildOpenAI('user-a');

    await expect(validateAuthor({ req, openai, requireOwnership: true })).resolves.toBeUndefined();
    expect(getAssistant).toHaveBeenCalledWith({ assistant_id: 'asst-param', user: 'user-a' });
    expect(openai.beta.assistants.retrieve).toHaveBeenCalledWith('asst-param');
  });

  test('allows administrators to manage another user assistant', async () => {
    hasCapability.mockResolvedValue(true);
    const req = buildRequest({ params: { id: 'asst-other' } });
    const openai = buildOpenAI('user-b');

    await expect(validateAuthor({ req, openai, requireOwnership: true })).resolves.toBeUndefined();
    expect(getAssistant).not.toHaveBeenCalled();
    expect(openai.beta.assistants.retrieve).not.toHaveBeenCalled();
  });

  test('keeps private assistant reads owner-only', async () => {
    const req = buildRequest({ privateAssistants: true, params: { id: 'asst-private' } });
    const openai = buildOpenAI('user-b');

    await expect(validateAuthor({ req, openai })).rejects.toThrow(
      'Assistant asst-private is not authored by the user.',
    );
  });
});
