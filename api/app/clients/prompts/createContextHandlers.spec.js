jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
jest.mock('@librechat/data-schemas', () => ({ logger: { error: jest.fn() } }));
jest.mock('@librechat/api', () => ({
  isEnabled: jest.fn(() => false), // RAG_USE_FULL_CONTEXT off → /query path
  generateShortLivedToken: jest.fn(() => 'jwt'),
}));

const axios = require('axios');
const createContextHandlers = require('./createContextHandlers');

describe('createContextHandlers — forced-floor retrieval depth (k)', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, RAG_API_URL: 'http://rag.test' };
    delete process.env.RAG_FORCED_CONTEXT_K;
    axios.post.mockResolvedValue({ data: [] });
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  const runQuery = async () => {
    const handlers = createContextHandlers({ user: { id: 'u1' } }, 'какой срок аренды?');
    await handlers.processFile({
      file_id: 'f1',
      filename: 'lease.pdf',
      type: 'application/pdf',
      embedded: true,
    });
    await handlers.createContext();
    return axios.post.mock.calls[0][1];
  };

  it('defaults the forced-floor depth to 8 (Stage-5 recall result)', async () => {
    const body = await runQuery();
    expect(body.k).toBe(8);
    expect(body.file_id).toBe('f1');
  });

  it('honors the RAG_FORCED_CONTEXT_K override', async () => {
    process.env.RAG_FORCED_CONTEXT_K = '12';
    const body = await runQuery();
    expect(body.k).toBe(12);
  });

  it('falls back to 8 when the override is non-numeric', async () => {
    process.env.RAG_FORCED_CONTEXT_K = 'oops';
    const body = await runQuery();
    expect(body.k).toBe(8);
  });

  it('degrades gracefully when RAG is unavailable, without throwing', async () => {
    axios.post.mockRejectedValue(new Error('ECONNREFUSED'));
    const handlers = createContextHandlers({ user: { id: 'u1' } }, 'какой срок аренды?');
    await handlers.processFile({
      file_id: 'f1',
      filename: 'lease.pdf',
      type: 'application/pdf',
      embedded: true,
    });

    const prompt = await handlers.createContext();

    expect(typeof prompt).toBe('string');
    expect(prompt).toMatch(/temporarily unavailable/i);
  });
});
