import type { TDocMetadata } from 'librechat-data-provider';
import type { LibrarySearchConfig, LibrarySearchParams } from './library';
import type { RagRerankConfig } from './rerank';
import { getLibrarySearchConfig, searchLibrary, LibrarySearchUnavailableError } from './library';

jest.mock('@librechat/data-schemas', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn(), info: jest.fn() },
}));

const RAG_URL = 'http://rag_api.internal:8000';
const RERANK_URL = 'http://reranker.internal:8000/v1/rerank';

const HYBRID_URL = 'http://library-search.internal:8000';

const CONFIG: LibrarySearchConfig = {
  poolSize: 48,
  topDocuments: 5,
  chunksPerDocument: 3,
  timeoutMs: 30_000,
  rerankTimeoutMs: 8_000,
  hybridUrl: null,
  hybridToken: null,
};

const RERANK_CONFIG: RagRerankConfig = {
  url: RERANK_URL,
  token: 'tok',
  candidates: 36,
  timeoutMs: 10_000,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** rag_api `/query_multiple` row shape: `[docInfo, distance]`. */
function row(fileId: string, content: string, distance: number, page?: number) {
  return [
    { page_content: content, metadata: { file_id: fileId, source: `/x/${fileId}.pdf`, page } },
    distance,
  ];
}

function baseParams(overrides: Partial<LibrarySearchParams> = {}): LibrarySearchParams {
  return {
    ragApiUrl: RAG_URL,
    jwtToken: 'jwt',
    query: 'договор аренды с ромашкой',
    fileIds: ['f1', 'f2', 'f3'],
    fileNames: new Map([
      ['f1', 'lease-romashka.pdf'],
      ['f2', 'lease-vasilek.pdf'],
      ['f3', 'nda.pdf'],
    ]),
    config: CONFIG,
    rerankConfig: null,
    fileCitations: false,
    ...overrides,
  };
}

describe('getLibrarySearchConfig', () => {
  it('returns tuned defaults when env is empty', () => {
    expect(getLibrarySearchConfig({})).toEqual({
      hybridUrl: null,
      hybridToken: null,
      poolSize: 48,
      topDocuments: 5,
      chunksPerDocument: 3,
      timeoutMs: 30_000,
      rerankTimeoutMs: 8_000,
    });
  });

  it('clamps out-of-range values to safe bounds', () => {
    const config = getLibrarySearchConfig({
      LIBRARY_SEARCH_POOL: '9999',
      LIBRARY_SEARCH_TOP_DOCS: '0',
      LIBRARY_SEARCH_CHUNKS_PER_DOC: '999',
      LIBRARY_SEARCH_TIMEOUT_MS: '10',
      LIBRARY_SEARCH_RERANK_TIMEOUT_MS: '999999',
    });
    expect(config).toEqual({
      poolSize: 64,
      topDocuments: 1,
      chunksPerDocument: 10,
      timeoutMs: 1_000,
      rerankTimeoutMs: 30_000,
      hybridUrl: null,
      hybridToken: null,
    });
  });

  it('reads the hybrid retriever endpoint and strips a trailing slash', () => {
    const config = getLibrarySearchConfig({
      LIBRARY_SEARCH_HYBRID_URL: ' http://library-search.internal:8000/ ',
      LIBRARY_SEARCH_HYBRID_TOKEN: ' tok ',
    });
    expect(config.hybridUrl).toBe('http://library-search.internal:8000');
    expect(config.hybridToken).toBe('tok');
  });

  it('treats a blank hybrid url as disabled', () => {
    expect(getLibrarySearchConfig({ LIBRARY_SEARCH_HYBRID_URL: '   ' }).hybridUrl).toBeNull();
    expect(getLibrarySearchConfig({}).hybridUrl).toBeNull();
  });
});

describe('searchLibrary', () => {
  it('short-circuits with no request when the scope is empty', async () => {
    const fetchImpl = jest.fn();
    const result = await searchLibrary(baseParams({ fileIds: [], fetchImpl: fetchImpl as never }));
    expect(result).toEqual({ content: '', sources: [], documentCount: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends ACL-collected file_ids to /query_multiple and groups hits by document', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse([
        row('f1', 'аренда с ООО Ромашка, п.1', 0.1),
        row('f1', 'ставка платы 1000', 0.2),
        row('f2', 'аренда с Василёк', 0.5),
      ]),
    );
    const result = await searchLibrary(baseParams({ fetchImpl: fetchImpl as never }));

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${RAG_URL}/query_multiple`);
    expect(JSON.parse(init.body as string)).toEqual({
      query: 'договор аренды с ромашкой',
      file_ids: ['f1', 'f2', 'f3'],
      k: 48,
    });
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt');

    expect(result.documentCount).toBe(2);
    expect(result.content).toContain('Document: lease-romashka.pdf');
    expect(result.content).toContain('Document: lease-vasilek.pdf');
    // Two chunks of f1 collapse under one document block, not two.
    expect(result.content.match(/Document:/g)).toHaveLength(2);
    expect(result.sources).toHaveLength(3);
    expect(result.sources[0]).toMatchObject({
      type: 'file',
      fileId: 'f1',
      fileName: 'lease-romashka.pdf',
    });
  });

  it('caps documents at topDocuments and the total chunk budget', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse([
        row('f1', 'a', 0.1),
        row('f1', 'b', 0.15),
        row('f1', 'c', 0.2),
        row('f2', 'd', 0.3),
        row('f3', 'e', 0.4),
      ]),
    );
    const result = await searchLibrary(
      baseParams({
        config: { ...CONFIG, topDocuments: 2, chunksPerDocument: 2 },
        fetchImpl: fetchImpl as never,
      }),
    );
    expect(result.documentCount).toBe(2);
    // f3 is dropped (beyond topDocuments); f1 + f2 stay within the 2*2 chunk budget.
    expect(result.sources.some((s) => s.fileId === 'f3')).toBe(false);
    expect(result.sources).toHaveLength(4);
    // f1 ranks first, so it absorbs the chunk f2 did not need — depth follows relevance.
    expect(result.sources.filter((s) => s.fileId === 'f1')).toHaveLength(3);
    expect(result.sources.filter((s) => s.fileId === 'f2')).toHaveLength(1);
  });

  it('gives a single matching document the whole chunk budget (named-document deep dive)', async () => {
    /* "Что сказано в договоре с Ромашкой про расторжение" collapses the result to one document.
     * Its extra passages must not be discarded just because chunksPerDocument is 3 — the budget
     * (topDocuments * chunksPerDocument) is what bounds the answer. */
    const fetchImpl = jest.fn(async () =>
      jsonResponse(
        Array.from({ length: 20 }, (_, i) => row('only-doc', `chunk-${i}`, 0.1 + i * 0.01)),
      ),
    );
    const result = await searchLibrary(
      baseParams({
        config: { ...CONFIG, topDocuments: 5, chunksPerDocument: 3 },
        fetchImpl: fetchImpl as never,
      }),
    );
    expect(result.documentCount).toBe(1);
    expect(result.sources).toHaveLength(15);
    // Depth is rank-ordered: the best passage still leads.
    expect(result.sources[0].content).toContain('chunk-0');
  });

  it('treats a 404 (rag_api empty result) as "nothing found", not an error', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({ detail: 'No documents found' }, 404));
    const result = await searchLibrary(baseParams({ fetchImpl: fetchImpl as never }));
    expect(result).toEqual({ content: '', sources: [], documentCount: 0 });
  });

  it('throws LibrarySearchUnavailableError on a network failure', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(
      searchLibrary(baseParams({ fetchImpl: fetchImpl as never })),
    ).rejects.toBeInstanceOf(LibrarySearchUnavailableError);
  });

  it('throws LibrarySearchUnavailableError on a 5xx', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({ detail: 'boom' }, 503));
    await expect(
      searchLibrary(baseParams({ fetchImpl: fetchImpl as never })),
    ).rejects.toBeInstanceOf(LibrarySearchUnavailableError);
  });

  it('reranks order-only: reorders documents but keeps the distance-based Relevance label', async () => {
    // Distance order would rank f1 first; the reranker promotes f2's chunk (index 2) to the top.
    const fetchImpl = jest.fn(async (url: string) => {
      if (url === RERANK_URL) {
        return jsonResponse({
          results: [
            { index: 2, relevance_score: 0.99 },
            { index: 0, relevance_score: 0.5 },
            { index: 1, relevance_score: 0.4 },
          ],
        });
      }
      return jsonResponse([
        row('f1', 'ромашка п.1', 0.1),
        row('f1', 'ромашка п.2', 0.2),
        row('f2', 'василёк', 0.5),
      ]);
    });
    const result = await searchLibrary(
      baseParams({ rerankConfig: RERANK_CONFIG, fetchImpl: fetchImpl as never }),
    );
    // f2 now leads because its chunk was reranked to position 0.
    expect(result.content.indexOf('Document: lease-vasilek.pdf')).toBeLessThan(
      result.content.indexOf('Document: lease-romashka.pdf'),
    );
    // Label stays 1 - distance (0.5 for the f2 chunk), NOT the rerank score 0.99 (урок 6).
    const f2Source = result.sources.find((s) => s.fileId === 'f2');
    expect(f2Source?.relevance).toBeCloseTo(0.5);
  });

  it('falls back to distance order when the reranker fails (fail-open)', async () => {
    const fetchImpl = jest.fn(async (url: string) => {
      if (url === RERANK_URL) {
        return jsonResponse({ detail: 'down' }, 500);
      }
      return jsonResponse([row('f1', 'первый', 0.1), row('f2', 'второй', 0.5)]);
    });
    const result = await searchLibrary(
      baseParams({ rerankConfig: RERANK_CONFIG, fetchImpl: fetchImpl as never }),
    );
    expect(result.documentCount).toBe(2);
    expect(result.content.indexOf('lease-romashka.pdf')).toBeLessThan(
      result.content.indexOf('lease-vasilek.pdf'),
    );
  });

  it('emits copy-exact citation anchors when fileCitations is on', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse([row('f1', 'текст', 0.1, 4)]));
    const result = await searchLibrary(
      baseParams({ fileCitations: true, fetchImpl: fetchImpl as never }),
    );
    expect(result.content).toContain('\\ue202turn0file0');
    expect(result.sources[0].pages).toEqual([4]);
  });

  it('masks model-visible content through transformContent (anonymizer egress)', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse([row('f1', 'Иванов Иван', 0.1)]));
    const transformContent = jest.fn(async (c: string) => c.replace('Иванов Иван', '[PERSON]'));
    const result = await searchLibrary(
      baseParams({ transformContent, fetchImpl: fetchImpl as never }),
    );
    expect(transformContent).toHaveBeenCalled();
    expect(result.content).toContain('[PERSON]');
    expect(result.content).not.toContain('Иванов Иван');
    // Sources (UI-only, user's own data) stay raw.
    expect(result.sources[0].content).toBe('Иванов Иван');
  });

  it('tolerates malformed rows without throwing', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse([
        null,
        [{ metadata: { file_id: 'f1' } }, 0.1], // no page_content
        [{ page_content: 'ok', metadata: {} }, 0.2], // no file_id
        row('f2', 'valid', 0.3),
      ]),
    );
    const result = await searchLibrary(baseParams({ fetchImpl: fetchImpl as never }));
    expect(result.documentCount).toBe(1);
    expect(result.sources[0].fileId).toBe('f2');
  });

  it('clamps a non-finite distance to relevance 0 (no "Relevance: -Infinity" in the prompt)', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse([
        [{ page_content: 'no distance', metadata: { file_id: 'f1', source: '/x/f1.pdf' } }], // distance missing
      ]),
    );
    const result = await searchLibrary(baseParams({ fetchImpl: fetchImpl as never }));
    expect(result.content).not.toContain('-Infinity');
    expect(result.content).toContain('Relevance: 0.0000');
    expect(result.sources[0].relevance).toBe(0);
  });

  it('appends pool chunks the reranker did not return (order-only keeps the tail)', async () => {
    // Reranker returns only index 2 → the other two chunks must NOT be dropped.
    const fetchImpl = jest.fn(async (url: string) => {
      if (url === RERANK_URL) {
        return jsonResponse({ results: [{ index: 2, relevance_score: 0.9 }] });
      }
      return jsonResponse([
        row('f1', 'ромашка', 0.1),
        row('f2', 'василёк', 0.2),
        row('f3', 'nda', 0.3),
      ]);
    });
    const result = await searchLibrary(
      baseParams({ rerankConfig: RERANK_CONFIG, fetchImpl: fetchImpl as never }),
    );
    // f3 (reranked to top) leads; f1 and f2 survive in the tail → all 3 documents present.
    expect(result.documentCount).toBe(3);
    expect(result.content.indexOf('nda.pdf')).toBeLessThan(
      result.content.indexOf('lease-romashka.pdf'),
    );
  });

  it('caps parsed chunks at poolSize even if the server over-returns (OOM defense)', async () => {
    const overReturn = Array.from({ length: 200 }, (_, i) => row('f1', `chunk ${i}`, 0.001 * i));
    const fetchImpl = jest.fn(async () => jsonResponse(overReturn));
    const result = await searchLibrary(
      baseParams({
        config: { ...CONFIG, poolSize: 10, chunksPerDocument: 50 },
        fetchImpl: fetchImpl as never,
      }),
    );
    // Only poolSize (10) chunks survive parsing → at most 10 sources for the single doc.
    expect(result.sources.length).toBeLessThanOrEqual(10);
  });

  it('reranks under the library rerank timeout even when the shared default is tiny', async () => {
    // rerankConfig.timeoutMs=1 would abort instantly; the library override (8000) is used
    // instead, so the rerank runs and reorders rather than failing open to distance order.
    const fetchImpl = jest.fn(async (url: string) => {
      if (url === RERANK_URL) {
        return jsonResponse({
          results: [
            { index: 1, relevance_score: 0.9 },
            { index: 0, relevance_score: 0.4 },
          ],
        });
      }
      return jsonResponse([row('f1', 'a', 0.1), row('f2', 'b', 0.2)]);
    });
    const result = await searchLibrary(
      baseParams({
        config: { ...CONFIG, rerankTimeoutMs: 8_000 },
        rerankConfig: { ...RERANK_CONFIG, timeoutMs: 1 },
        fetchImpl: fetchImpl as never,
      }),
    );
    // f2 (reranked to top) leads → the rerank actually took effect.
    expect(result.content.indexOf('lease-vasilek.pdf')).toBeLessThan(
      result.content.indexOf('lease-romashka.pdf'),
    );
  });
});

describe('searchLibrary — hybrid retriever (Ф2)', () => {
  const hybridConfig = { ...CONFIG, hybridUrl: HYBRID_URL, hybridToken: 'htok' };

  it('queries the hybrid retriever with its own token when configured', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse([row('f1', 'a', 0.1)]));
    await searchLibrary(baseParams({ config: hybridConfig, fetchImpl: fetchImpl as never }));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${HYBRID_URL}/query_multiple`);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer htok');
  });

  it('preserves the RRF order of the hybrid response instead of sorting by distance', async () => {
    // The lexical arm's exact hit (f2) is FURTHER by cosine but first by RRF. Sorting by
    // distance here would silently undo the whole point of the hybrid.
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        jsonResponse([row('f2', 'exact №312/24', 0.9), row('f1', 'boilerplate', 0.1)]),
      );
    const result = await searchLibrary(
      baseParams({ config: hybridConfig, fetchImpl: fetchImpl as never }),
    );
    expect(result.content.indexOf('lease-vasilek.pdf')).toBeLessThan(
      result.content.indexOf('lease-romashka.pdf'),
    );
  });

  it('still sorts by distance on the plain dense path', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(jsonResponse([row('f2', 'far', 0.9), row('f1', 'near', 0.1)]));
    const result = await searchLibrary(baseParams({ fetchImpl: fetchImpl as never }));
    expect(result.content.indexOf('lease-romashka.pdf')).toBeLessThan(
      result.content.indexOf('lease-vasilek.pdf'),
    );
  });

  it('fails open to rag_api when the hybrid retriever is down', async () => {
    const fetchImpl = jest.fn(async (url: string) => {
      if (url.startsWith(HYBRID_URL)) {
        return jsonResponse({ detail: 'not ready' }, 503);
      }
      return jsonResponse([row('f1', 'dense hit', 0.2)]);
    });
    const result = await searchLibrary(
      baseParams({ config: hybridConfig, fetchImpl: fetchImpl as never }),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][0]).toBe(`${RAG_URL}/query_multiple`);
    expect(result.documentCount).toBe(1);
    expect(result.content).toContain('dense hit');
  });

  it('fails open to rag_api when the hybrid retriever times out', async () => {
    const fetchImpl = jest.fn(async (url: string) => {
      if (url.startsWith(HYBRID_URL)) {
        throw Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' });
      }
      return jsonResponse([row('f1', 'dense hit', 0.2)]);
    });
    const result = await searchLibrary(
      baseParams({ config: hybridConfig, fetchImpl: fetchImpl as never }),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.documentCount).toBe(1);
  });

  it('does NOT re-query rag_api when the hybrid legitimately finds nothing', async () => {
    // An empty hybrid answer is a valid "no results" — falling back would double every miss.
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse([]));
    const result = await searchLibrary(
      baseParams({ config: hybridConfig, fetchImpl: fetchImpl as never }),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ content: '', sources: [], documentCount: 0 });
  });
});

describe('searchLibrary — карточка документа и перечисление (Ф3)', () => {
  const LEASE_META: TDocMetadata = {
    docType: 'договор',
    parties: ['Ромашка Плюс', 'Юнифуд'],
    primaryDate: '2024-01-15',
    primaryLocation: 'Минск',
    identifiers: [{ type: 'DOC_NO', value: '312/24' }],
    columns: [],
  };

  const fetchOne = () =>
    jest.fn().mockResolvedValue(jsonResponse([row('f1', 'предмет аренды', 0.2)]));

  it('шапкой документа идёт карточка: тип, стороны, дата, место, номер', async () => {
    const result = await searchLibrary(
      baseParams({
        fetchImpl: fetchOne() as never,
        fileMetadata: new Map([['f1', LEASE_META]]),
      }),
    );
    expect(result.content).toContain('Document: lease-romashka.pdf');
    expect(result.content).toContain(
      'Type: договор | Parties: Ромашка Плюс, Юнифуд | Date: 2024-01-15 | Place: Минск | No: 312/24',
    );
  });

  it('без метаданных выдача как в Ф1 — без пустой карточки', async () => {
    const result = await searchLibrary(baseParams({ fetchImpl: fetchOne() as never }));
    expect(result.content).toContain('Document: lease-romashka.pdf');
    expect(result.content).not.toContain('Type:');
    expect(result.content).not.toContain('Parties:');
  });

  it('пустые поля опускает: «Parties: —» модель прочла бы как «сторон нет»', async () => {
    const result = await searchLibrary(
      baseParams({
        fetchImpl: fetchOne() as never,
        fileMetadata: new Map([
          [
            'f1',
            { docType: 'таблица', parties: [], identifiers: [], columns: ['компания', 'телефон'] },
          ],
        ]),
      }),
    );
    expect(result.content).toContain('Type: таблица | Columns: компания, телефон');
    expect(result.content).not.toContain('Parties:');
    expect(result.content).not.toContain('Date:');
  });

  it('перечисление: отдаёт ВЕСЬ совпавший набор, а не только документы с фрагментами', async () => {
    const result = await searchLibrary(
      baseParams({
        fetchImpl: fetchOne() as never,
        fileMetadata: new Map([['f1', LEASE_META]]),
        matchedDocuments: [
          { fileId: 'f1', filename: 'lease-romashka.pdf', docMetadata: LEASE_META },
          {
            fileId: 'f9',
            filename: 'lease-vasilek.pdf',
            docMetadata: { ...LEASE_META, parties: ['Василёк'] },
          },
        ],
        matchedTotal: 2,
      }),
    );
    expect(result.content).toContain('extracted attributes match (2)');
    expect(result.content).toContain('IS the complete answer');
    expect(result.content).toContain('1. lease-romashka.pdf — Type: договор');
    expect(result.content).toContain('2. lease-vasilek.pdf');
    expect(result.content).toContain('Passages from the most relevant of them:');
  });

  /* Связка двух этапов: найти → открыть. Без стабильного handle в выдаче модели нечего
   * передать в open_document — она видит имя файла, а тул принимает id. Проверяем ОБА места,
   * где документ показывается: блок с фрагментами и перечисление по фильтру. */
  it('выдача несёт Document ID — иначе второй этап (open_document) нечем вызвать', async () => {
    const result = await searchLibrary(
      baseParams({
        fetchImpl: fetchOne() as never,
        fileMetadata: new Map([['f1', LEASE_META]]),
        matchedDocuments: [
          { fileId: 'f1', filename: 'lease-romashka.pdf', docMetadata: LEASE_META },
          { fileId: 'f9', filename: 'lease-vasilek.pdf' },
        ],
        matchedTotal: 2,
      }),
    );
    expect(result.content).toContain('Document: lease-romashka.pdf');
    expect(result.content).toContain('Document ID: f1');
    expect(result.content).toContain('2. lease-vasilek.pdf — Document ID: f9');
  });

  it('обрезанный список честно говорит модели, что он неполный', async () => {
    const result = await searchLibrary(
      baseParams({
        fetchImpl: fetchOne() as never,
        matchedDocuments: [{ fileId: 'f1', filename: 'a.pdf' }],
        matchedTotal: 120,
      }),
    );
    expect(result.content).toContain('showing the 1 most recently updated of 120');
    expect(result.content).toContain('ALWAYS tell the user the list is partial');
    expect(result.content).not.toContain('IS the complete answer');
  });

  it('НЕ объявляет полноту, когда часть библиотеки проверить было нечем', async () => {
    /* У таблицы никогда нет сторон, у скана с провалившимся OCR — ничего. Заявить «вот все
     * договоры с Ромашкой», не проверив 200 документов, — это обмануть юриста. */
    const result = await searchLibrary(
      baseParams({
        fetchImpl: fetchOne() as never,
        matchedDocuments: [{ fileId: 'f1', filename: 'a.pdf' }],
        matchedTotal: 1,
        unfilterableCount: 200,
      }),
    );
    expect(result.content).toContain('200 other documents have no extracted value');
    expect(result.content).toContain('NOT the full answer');
    expect(result.content).not.toContain('IS the complete answer');
    expect(result.content).toContain('may include documents NOT in the list above');
  });

  it('набор доходит до модели, даже если ретривал не дал НИ ОДНОГО фрагмента', async () => {
    /* Ровно тот случай, ради которого фильтр и делался: top-K не справился. Выбросить здесь
     * готовый список = ответить «ничего не найдено», имея на руках ответ. */
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse([]));
    const result = await searchLibrary(
      baseParams({
        fetchImpl: fetchImpl as never,
        matchedDocuments: [
          { fileId: 'f1', filename: 'lease-romashka.pdf', docMetadata: LEASE_META },
        ],
        matchedTotal: 1,
      }),
    );
    expect(result.documentCount).toBe(1);
    expect(result.content).toContain('1. lease-romashka.pdf — Type: договор');
    expect(result.sources).toEqual([]);
  });

  it('карточка и список ПРОХОДЯТ анонимайзер: имена сторон = ПДн', async () => {
    const transformContent = jest.fn(async (c: string) => c.replace(/Ромашка Плюс/g, '[[ORG_1]]'));
    const result = await searchLibrary(
      baseParams({
        fetchImpl: fetchOne() as never,
        transformContent,
        fileMetadata: new Map([['f1', LEASE_META]]),
        matchedDocuments: [
          { fileId: 'f1', filename: 'lease-romashka.pdf', docMetadata: LEASE_META },
        ],
        matchedTotal: 1,
      }),
    );
    // Один шов маскировки на всю model-visible выдачу — и список, и карточка, и фрагменты.
    expect(transformContent).toHaveBeenCalledTimes(1);
    expect(result.content).not.toContain('Ромашка Плюс');
    expect(result.content).toContain('[[ORG_1]]');
  });

  it('без фильтра списка нет — обычный поиск выглядит как прежде', async () => {
    const result = await searchLibrary(
      baseParams({ fetchImpl: fetchOne() as never, matchedDocuments: [], matchedTotal: 0 }),
    );
    expect(result.content).not.toContain('matching the requested attributes');
  });
});
