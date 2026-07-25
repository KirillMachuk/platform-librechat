jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
jest.mock('@librechat/data-schemas', () => ({ logger: { error: jest.fn() } }));
jest.mock('@librechat/api', () => ({
  isEnabled: jest.fn(() => false), // RAG_USE_FULL_CONTEXT off → /query path
  generateShortLivedToken: jest.fn(() => 'jwt'),
  logAxiosError: jest.fn(),
  // Pass-through limiter: run each task immediately so tests observe the calls.
  createConcurrencyLimiter: jest.fn(() => (task) => task()),
  // Rerank OFF by default so the existing forced-floor assertions are unchanged;
  // the R1 suite below opts in per-test.
  getRagRerankConfig: jest.fn(() => null),
  rerankOrder: jest.fn(),
}));

const axios = require('axios');
const createContextHandlers = require('./createContextHandlers');

const embeddedFile = (overrides = {}) => ({
  file_id: 'f1',
  filename: 'lease.pdf',
  type: 'application/pdf',
  embedded: true,
  ...overrides,
});

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
    await handlers.processFile(embeddedFile());
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
    await handlers.processFile(embeddedFile());

    const prompt = await handlers.createContext();

    expect(typeof prompt).toBe('string');
    expect(prompt).toMatch(/temporarily unavailable/i);
  });
});

describe('createContextHandlers — RAG query-path hardening (D4/D5/D7/D16)', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, RAG_API_URL: 'http://rag.test' };
    delete process.env.RAG_API_TIMEOUT_MS;
    axios.post.mockResolvedValue({ data: [] });
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('D4: sends a finite timeout on every /query call', async () => {
    const handlers = createContextHandlers({ user: { id: 'u1' } }, 'q');
    await handlers.processFile(embeddedFile());
    await handlers.createContext();
    const options = axios.post.mock.calls[0][2];
    expect(options.timeout).toBe(30000);
  });

  it('D7: forwards entity_id = embedEntityId when present', async () => {
    const handlers = createContextHandlers({ user: { id: 'u1' } }, 'q');
    await handlers.processFile(embeddedFile({ embedEntityId: 'agent-123', project_id: 'proj-9' }));
    await handlers.createContext();
    expect(axios.post.mock.calls[0][1].entity_id).toBe('agent-123');
  });

  it('D7: falls back to project_id when embedEntityId is absent', async () => {
    const handlers = createContextHandlers({ user: { id: 'u1' } }, 'q');
    await handlers.processFile(embeddedFile({ project_id: 'proj-9' }));
    await handlers.createContext();
    expect(axios.post.mock.calls[0][1].entity_id).toBe('proj-9');
  });

  it('D7: omits entity_id for legacy files that have neither', async () => {
    const handlers = createContextHandlers({ user: { id: 'u1' } }, 'q');
    await handlers.processFile(embeddedFile());
    await handlers.createContext();
    expect('entity_id' in axios.post.mock.calls[0][1]).toBe(false);
  });

  it('D5: one file failing does not strip context from the others', async () => {
    axios.post
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ data: [[{ page_content: 'Срок аренды 5 лет' }]] });

    const handlers = createContextHandlers({ user: { id: 'u1' } }, 'q');
    await handlers.processFile(embeddedFile({ file_id: 'f1', filename: 'broken.pdf' }));
    await handlers.processFile(embeddedFile({ file_id: 'f2', filename: 'good.pdf' }));

    const prompt = await handlers.createContext();

    expect(prompt).toContain('Срок аренды 5 лет');
    expect(prompt).toContain('good.pdf');
    expect(prompt).not.toMatch(/temporarily unavailable/i);
  });

  it('D16: a malformed /query response does not throw', async () => {
    axios.post.mockResolvedValue({ data: [[{ notPageContent: true }, 0.4], null, 'garbage'] });

    const handlers = createContextHandlers({ user: { id: 'u1' } }, 'q');
    await handlers.processFile(embeddedFile());

    await expect(handlers.createContext()).resolves.toEqual(expect.any(String));
  });

  it('D16: a non-array data payload is tolerated (no throw, file still listed)', async () => {
    axios.post.mockResolvedValue({ data: { error: 'unexpected shape' } });

    const handlers = createContextHandlers({ user: { id: 'u1' } }, 'q');
    await handlers.processFile(embeddedFile({ filename: 'weird.pdf' }));

    const prompt = await handlers.createContext();
    expect(prompt).toContain('weird.pdf');
    expect(prompt).not.toMatch(/temporarily unavailable/i);
  });
});

describe('createContextHandlers — forced-floor rerank (R1)', () => {
  const ORIGINAL_ENV = process.env;
  const { isEnabled, getRagRerankConfig, rerankOrder } = require('@librechat/api');

  const RERANK = {
    url: 'http://reranker.test/v1/rerank',
    token: '',
    candidates: 36,
    timeoutMs: 8000,
  };
  const chunk = (text) => [{ page_content: text }, 0.1];

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, RAG_API_URL: 'http://rag.test' };
    delete process.env.RAG_FORCED_CONTEXT_K;
    isEnabled.mockReturnValue(false);
    axios.post.mockResolvedValue({ data: [] });
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('widens the per-file /query pool to the candidate count when rerank is enabled', async () => {
    getRagRerankConfig.mockReturnValue(RERANK);
    rerankOrder.mockResolvedValue(null);

    const handlers = createContextHandlers({ user: { id: 'u1' } }, 'q');
    await handlers.processFile(embeddedFile());
    await handlers.createContext();

    // pool = max(forcedFloorK=8, candidates=36); rerank cuts back to 8 afterwards
    expect(axios.post.mock.calls[0][1].k).toBe(36);
  });

  it('keeps k = forcedFloorK (no wider pool) when rerank is disabled', async () => {
    getRagRerankConfig.mockReturnValue(null);

    const handlers = createContextHandlers({ user: { id: 'u1' } }, 'q');
    await handlers.processFile(embeddedFile());
    await handlers.createContext();

    expect(axios.post.mock.calls[0][1].k).toBe(8);
    expect(rerankOrder).not.toHaveBeenCalled();
  });

  it('reorders chunks by the reranker and cuts to forcedFloorK', async () => {
    process.env.RAG_FORCED_CONTEXT_K = '2';
    getRagRerankConfig.mockReturnValue({ ...RERANK, candidates: 4 });
    axios.post.mockResolvedValue({
      data: [chunk('ALPHA'), chunk('BRAVO'), chunk('CHARLIE'), chunk('DELTA')],
    });
    rerankOrder.mockResolvedValue([
      { index: 2, score: 0.9 },
      { index: 0, score: 0.8 },
    ]);

    const handlers = createContextHandlers({ user: { id: 'u1' } }, 'какой пункт?');
    await handlers.processFile(embeddedFile());
    const prompt = await handlers.createContext();

    // reranker was handed the file's chunk texts and asked for the floor depth
    expect(rerankOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'какой пункт?',
        documents: ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA'],
        topN: 2,
      }),
    );
    // top-2 reranked = CHARLIE then ALPHA; BRAVO/DELTA dropped by the cut
    expect(prompt.indexOf('CHARLIE')).toBeGreaterThan(-1);
    expect(prompt.indexOf('CHARLIE')).toBeLessThan(prompt.indexOf('ALPHA'));
    expect(prompt).not.toContain('BRAVO');
    expect(prompt).not.toContain('DELTA');
  });

  it('fail-open: a null rerank order keeps distance order, cut to forcedFloorK', async () => {
    process.env.RAG_FORCED_CONTEXT_K = '2';
    getRagRerankConfig.mockReturnValue({ ...RERANK, candidates: 4 });
    axios.post.mockResolvedValue({
      data: [chunk('ALPHA'), chunk('BRAVO'), chunk('CHARLIE'), chunk('DELTA')],
    });
    rerankOrder.mockResolvedValue(null); // reranker down/timeout/5xx

    const handlers = createContextHandlers({ user: { id: 'u1' } }, 'q');
    await handlers.processFile(embeddedFile());
    const prompt = await handlers.createContext();

    // degrades to exactly the pre-rerank output: distance-order top-2
    expect(prompt).toContain('ALPHA');
    expect(prompt).toContain('BRAVO');
    expect(prompt).not.toContain('CHARLIE');
    expect(prompt).not.toContain('DELTA');
  });

  it('reranks each file independently (per-file top-k, no cross-file merge)', async () => {
    process.env.RAG_FORCED_CONTEXT_K = '1';
    getRagRerankConfig.mockReturnValue({ ...RERANK, candidates: 2 });
    axios.post
      .mockResolvedValueOnce({ data: [chunk('A_ONE'), chunk('A_TWO')] })
      .mockResolvedValueOnce({ data: [chunk('B_ONE'), chunk('B_TWO')] });
    // each file: pick its second chunk
    rerankOrder.mockResolvedValue([{ index: 1, score: 0.9 }]);

    const handlers = createContextHandlers({ user: { id: 'u1' } }, 'q');
    await handlers.processFile(embeddedFile({ file_id: 'f1', filename: 'a.pdf' }));
    await handlers.processFile(embeddedFile({ file_id: 'f2', filename: 'b.pdf' }));
    const prompt = await handlers.createContext();

    expect(rerankOrder).toHaveBeenCalledTimes(2);
    expect(prompt).toContain('A_TWO');
    expect(prompt).toContain('B_TWO');
    expect(prompt).not.toContain('A_ONE');
    expect(prompt).not.toContain('B_ONE');
  });

  it('does not rerank in full-context mode (whole-document path)', async () => {
    isEnabled.mockReturnValue(true); // RAG_USE_FULL_CONTEXT on
    axios.get.mockResolvedValue({ data: 'full document text' });

    const handlers = createContextHandlers({ user: { id: 'u1' } }, 'q');
    await handlers.processFile(embeddedFile());
    await handlers.createContext();

    expect(getRagRerankConfig).not.toHaveBeenCalled();
    expect(rerankOrder).not.toHaveBeenCalled();
    expect(axios.get).toHaveBeenCalled();
  });
});
