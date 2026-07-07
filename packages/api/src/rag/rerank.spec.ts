import { getRagRerankConfig, rerankOrder } from './rerank';
import type { RagRerankConfig } from './rerank';

jest.mock('@librechat/data-schemas', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn(), info: jest.fn() },
}));

const CONFIG: RagRerankConfig = {
  url: 'http://reranker.internal:8000/v1/rerank',
  token: 'secret-token',
  candidates: 36,
  timeoutMs: 2500,
};

const DOCS = ['пункт о расторжении', 'шумовой текст', 'пеня за просрочку'];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('getRagRerankConfig', () => {
  it('returns null when RAG_RERANKER_URL is empty/absent (feature off)', () => {
    expect(getRagRerankConfig({})).toBeNull();
    expect(getRagRerankConfig({ RAG_RERANKER_URL: '   ' })).toBeNull();
  });

  it('parses defaults and clamps out-of-range values', () => {
    const config = getRagRerankConfig({ RAG_RERANKER_URL: CONFIG.url });
    expect(config).toEqual({ url: CONFIG.url, token: '', candidates: 36, timeoutMs: 2500 });

    const clamped = getRagRerankConfig({
      RAG_RERANKER_URL: CONFIG.url,
      RAG_RERANKER_TOKEN: '  tok  ',
      RAG_RERANK_CANDIDATES: '9999',
      RAG_RERANKER_TIMEOUT_MS: '1',
    });
    expect(clamped).toEqual({ url: CONFIG.url, token: 'tok', candidates: 64, timeoutMs: 100 });
  });
});

describe('rerankOrder', () => {
  it('POSTs the Jina schema (+max_documents extension) and returns ranked indexes', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse({
        results: [
          { index: 2, relevance_score: 0.91 },
          { index: 0, relevance_score: 0.4 },
        ],
      }),
    );

    const ranked = await rerankOrder({
      config: CONFIG,
      query: 'какая неустойка за просрочку',
      documents: DOCS,
      topN: 2,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(ranked).toEqual([
      { index: 2, score: 0.91 },
      { index: 0, score: 0.4 },
    ]);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(CONFIG.url);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-token');
    expect(JSON.parse(init.body as string)).toEqual({
      query: 'какая неустойка за просрочку',
      documents: DOCS,
      top_n: 2,
      return_documents: false,
      max_documents: DOCS.length,
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ['HTTP 503', jsonResponse({ detail: 'loading' }, 503)],
    ['HTTP 401', jsonResponse({ detail: 'bad token' }, 401)],
    ['malformed body', jsonResponse({ nope: true })],
    ['empty results', jsonResponse({ results: [] })],
  ])('fail-open → null on %s', async (_label, response) => {
    const fetchImpl = jest.fn(async () => response);
    const ranked = await rerankOrder({
      config: CONFIG,
      query: 'q',
      documents: DOCS,
      topN: 3,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(ranked).toBeNull();
  });

  it('fail-open → null when fetch rejects (network error / timeout abort)', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    });
    const ranked = await rerankOrder({
      config: CONFIG,
      query: 'q',
      documents: DOCS,
      topN: 3,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(ranked).toBeNull();
  });

  it('drops out-of-range/duplicate/NaN indexes instead of trusting the server blindly', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse({
        results: [
          { index: 99, relevance_score: 0.9 },
          { index: 1, relevance_score: 0.8 },
          { index: 1, relevance_score: 0.7 },
          { index: 0, relevance_score: 'oops' },
          { index: 2, relevance_score: 0.6 },
        ],
      }),
    );
    const ranked = await rerankOrder({
      config: CONFIG,
      query: 'q',
      documents: DOCS,
      topN: 5,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(ranked).toEqual([
      { index: 1, score: 0.8 },
      { index: 2, score: 0.6 },
    ]);
  });

  it('skips the call entirely for pools of <2 documents (nothing to reorder)', async () => {
    const fetchImpl = jest.fn();
    const ranked = await rerankOrder({
      config: CONFIG,
      query: 'q',
      documents: ['один'],
      topN: 1,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(ranked).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
