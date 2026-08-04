const express = require('express');
const request = require('supertest');

const mockCheckMemoryValue = jest.fn();
const mockCreateMemory = jest.fn();
const mockSetMemory = jest.fn();
const mockGetAllUserMemories = jest.fn();

jest.mock('@librechat/api', () => ({
  Tokenizer: { getTokenCount: jest.fn(() => 5) },
  generateCheckAccess: jest.fn(() => (_req, _res, next) => next()),
  checkMemoryValue: (...args) => mockCheckMemoryValue(...args),
}));

jest.mock('~/models', () => ({
  getAllUserMemories: (...args) => mockGetAllUserMemories(...args),
  toggleUserMemories: jest.fn(),
  getRoleByName: jest.fn(),
  createMemory: (...args) => mockCreateMemory(...args),
  deleteMemory: jest.fn(),
  setMemory: (...args) => mockSetMemory(...args),
}));

jest.mock('~/server/middleware/limiters', () => ({
  memoryWriteLimiter: (_req, _res, next) => next(),
}));

jest.mock('~/server/middleware', () => ({
  requireJwtAuth: (req, _res, next) => {
    req.user = { id: 'user-123' };
    next();
  },
  configMiddleware: (req, _res, next) => {
    req.config = { memory: { tokenLimit: 2000, charLimit: 10000 } };
    next();
  },
}));

const PERSONAL_DATA = 'Клиент Иван Петров, тел. +375291234567';
const WORKING_PROFILE = 'Юрист отдела аренды, отвечать таблицами';

describe('memories routes — personal-data guard', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAllUserMemories.mockResolvedValue([{ key: 'context', value: 'x', tokenCount: 1 }]);
    mockCreateMemory.mockResolvedValue({ ok: true });
    mockSetMemory.mockResolvedValue({ ok: true });

    app = express();
    app.use(express.json());
    app.use('/api/memories', require('~/server/routes/memories'));
  });

  describe('POST /api/memories', () => {
    it('stores a working-profile value the guard clears', async () => {
      mockCheckMemoryValue.mockResolvedValue({ outcome: 'allowed' });

      const res = await request(app)
        .post('/api/memories')
        .send({ key: 'context', value: WORKING_PROFILE });

      expect(res.status).toBe(201);
      expect(mockCreateMemory).toHaveBeenCalled();
    });

    it('refuses a hand-written value carrying personal data', async () => {
      mockCheckMemoryValue.mockResolvedValue({ outcome: 'rejected', types: ['PERSON', 'PHONE'] });

      const res = await request(app)
        .post('/api/memories')
        .send({ key: 'context', value: PERSONAL_DATA });

      expect(res.status).toBe(422);
      expect(res.body.errorType).toBe('personal_data');
      expect(res.body.entityTypes).toEqual(['PERSON', 'PHONE']);
      expect(mockCreateMemory).not.toHaveBeenCalled();
      /* The rejection travels as types; echoing the value back would put the very
         data we refused to store into a log line and a toast. */
      expect(JSON.stringify(res.body)).not.toContain('Иван');
      expect(JSON.stringify(res.body)).not.toContain('375291234567');
    });

    it('refuses to store anything while the guard is unavailable', async () => {
      mockCheckMemoryValue.mockResolvedValue({ outcome: 'unavailable' });

      const res = await request(app)
        .post('/api/memories')
        .send({ key: 'context', value: WORKING_PROFILE });

      expect(res.status).toBe(503);
      expect(res.body.errorType).toBe('guard_unavailable');
      expect(mockCreateMemory).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /api/memories/:key', () => {
    it('refuses an edit that introduces personal data', async () => {
      mockCheckMemoryValue.mockResolvedValue({ outcome: 'rejected', types: ['PERSON'] });

      const res = await request(app).patch('/api/memories/context').send({ value: PERSONAL_DATA });

      expect(res.status).toBe(422);
      expect(res.body.errorType).toBe('personal_data');
      expect(mockSetMemory).not.toHaveBeenCalled();
      expect(mockCreateMemory).not.toHaveBeenCalled();
    });

    it('stores an edit the guard clears', async () => {
      mockCheckMemoryValue.mockResolvedValue({ outcome: 'allowed' });

      const res = await request(app)
        .patch('/api/memories/context')
        .send({ value: WORKING_PROFILE });

      expect(res.status).toBe(200);
      expect(mockSetMemory).toHaveBeenCalled();
    });
  });
});
