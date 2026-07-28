const express = require('express');
const request = require('supertest');

/**
 * A search hit inside a project has to know its project, or the client cannot
 * build the URL the chat actually lives at (/projects/<id>/c/<id>). The
 * conversation search already returns project_id; the message search dropped it
 * while copying fields off the conversation, so message hits linked to /c/<id>
 * and relied on the app noticing and rewriting the URL afterwards.
 */

jest.mock('@librechat/agents', () => ({ sleep: jest.fn() }));
jest.mock('@librechat/api', () => ({
  unescapeLaTeX: jest.fn((x) => x),
  countTokens: jest.fn().mockResolvedValue(10),
}));
jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('~/models', () => ({
  saveConvo: jest.fn(),
  getMessage: jest.fn(),
  saveMessage: jest.fn(),
  getMessages: jest.fn(),
  updateMessage: jest.fn(),
  deleteMessages: jest.fn(),
  getConvosQueried: jest.fn(),
  searchMessages: jest.fn(),
  getMessagesByCursor: jest.fn(),
}));

jest.mock('~/server/services/Artifacts/update', () => ({
  findAllArtifacts: jest.fn(),
  replaceArtifactContent: jest.fn(),
}));

jest.mock('~/server/middleware/requireJwtAuth', () => (req, res, next) => next());
jest.mock('~/server/middleware', () => ({
  requireJwtAuth: (req, res, next) => next(),
  validateMessageReq: (req, res, next) => next(),
}));

jest.mock('~/db/models', () => ({
  Message: { findOne: jest.fn(), find: jest.fn(), meiliSearch: jest.fn() },
}));

const { searchMessages, getConvosQueried, getMessages } = require('~/models');

const PROJECT_CONVO = 'convo-in-a-project';
const LOOSE_CONVO = 'convo-with-no-project';

function buildApp() {
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: 'user-1' };
    next();
  });
  app.use('/api/messages', require('../messages'));
  return app;
}

describe('GET /api/messages?search — project of a message hit', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    searchMessages.mockResolvedValue({
      hits: [
        { messageId: 'm-1', conversationId: PROJECT_CONVO, text: 'субаренда' },
        { messageId: 'm-2', conversationId: LOOSE_CONVO, text: 'субаренда' },
      ],
    });

    // getConvosQueried returns whole conversation documents, so project_id is
    // already in hand here — it was simply not copied onto the hit.
    getConvosQueried.mockResolvedValue({
      convoMap: {
        [PROJECT_CONVO]: {
          conversationId: PROJECT_CONVO,
          title: 'Договор аренды',
          model: 'gpt-4',
          project_id: 'proj-42',
        },
        [LOOSE_CONVO]: {
          conversationId: LOOSE_CONVO,
          title: 'Просто чат',
          model: 'gpt-4',
        },
      },
    });

    getMessages.mockResolvedValue([
      { messageId: 'm-1', isCreatedByUser: true, endpoint: 'openAI' },
      { messageId: 'm-2', isCreatedByUser: true, endpoint: 'openAI' },
    ]);
  });

  it('carries the project so the hit can link where the chat lives', async () => {
    const res = await request(buildApp()).get('/api/messages?search=%D1%81%D1%83%D0%B1');

    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.messages.map((m) => [m.messageId, m]));
    expect(byId['m-1'].project_id).toBe('proj-42');
  });

  it('leaves a chat outside any project without one', async () => {
    const res = await request(buildApp()).get('/api/messages?search=%D1%81%D1%83%D0%B1');

    const byId = Object.fromEntries(res.body.messages.map((m) => [m.messageId, m]));
    expect(byId['m-2'].project_id).toBeUndefined();
  });
});
