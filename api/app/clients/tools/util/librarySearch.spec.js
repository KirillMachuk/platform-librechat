const { Tools } = require('librechat-data-provider');

jest.mock('@librechat/api', () => ({
  generateShortLivedToken: jest.fn(() => 'jwt-token'),
  getRagRerankConfig: jest.fn(() => null),
  getLibrarySearchConfig: jest.fn(() => ({
    poolSize: 48,
    topDocuments: 5,
    chunksPerDocument: 3,
    timeoutMs: 30000,
    rerankTimeoutMs: 8000,
  })),
  searchLibrary: jest.fn(),
  LibrarySearchUnavailableError: class LibrarySearchUnavailableError extends Error {},
}));
jest.mock('~/models', () => ({ getFiles: jest.fn(), countFiles: jest.fn() }));

const { searchLibrary, LibrarySearchUnavailableError } = require('@librechat/api');
const { getFiles, countFiles } = require('~/models');
const { createLibrarySearchTool, primeLibraryScope, buildStatusNote } = require('./librarySearch');

/** ready files + [indexingCount, failedCount] */
function mockScope(ready, indexing = 0, failed = 0) {
  getFiles.mockResolvedValueOnce(ready);
  countFiles.mockResolvedValueOnce(indexing).mockResolvedValueOnce(failed);
}

function invoke(libraryTool) {
  return libraryTool.invoke({
    name: Tools.library_search,
    args: { query: 'договор аренды с ромашкой' },
    id: 't1',
    type: 'tool_call',
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.RAG_API_URL = 'http://rag.internal:8000';
});

describe('primeLibraryScope — ACL-собранный скоуп библиотеки', () => {
  it('collects ready files (capped), excludes temp/project, counts indexing+failed', async () => {
    mockScope(
      [
        { file_id: 'f1', filename: 'lease.pdf' },
        { file_id: 'f2', filename: 'nda.pdf' },
      ],
      3,
      1,
    );
    const scope = await primeLibraryScope('user-1', 'tenant-1');

    // Ready query: own files, project excluded, tenant belt-and-suspenders, visibility rule, capped.
    const [filter, sort, select, limit] = getFiles.mock.calls[0];
    expect(filter).toEqual({
      user: 'user-1',
      tenantId: 'tenant-1',
      project_id: null,
      embedded: true,
      $and: [
        {
          temporary: { $ne: true },
          $or: [{ expiredAt: null }, { temporary: false, expiredAt: { $gt: expect.any(Date) } }],
        },
      ],
    });
    expect(sort).toBeNull();
    expect(select).toEqual({ file_id: 1, filename: 1, docMetadata: 1 });
    expect(typeof limit).toBe('number');
    expect(limit).toBeGreaterThan(0);

    expect(scope.fileIds).toEqual(['f1', 'f2']);
    expect(scope.fileNames.get('f1')).toBe('lease.pdf');
    expect(scope.indexingCount).toBe(3);
    expect(scope.failedCount).toBe(1);
    expect(scope.truncated).toBe(false);
  });

  it('omits tenantId from the filter when not provided', async () => {
    mockScope([], 0, 0);
    await primeLibraryScope('user-1');
    expect(getFiles.mock.calls[0][0]).not.toHaveProperty('tenantId');
  });

  it('skips records without a file_id and tolerates nullish results', async () => {
    getFiles.mockResolvedValueOnce([
      { filename: 'orphan.pdf' },
      { file_id: 'f3', filename: 'ok.pdf' },
    ]);
    countFiles.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    const scope = await primeLibraryScope('user-1');
    expect(scope.fileIds).toEqual(['f3']);

    getFiles.mockResolvedValueOnce(null);
    countFiles.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    const empty = await primeLibraryScope('user-1');
    expect(empty.fileIds).toEqual([]);
  });
});

describe('buildStatusNote', () => {
  it('is empty when nothing to report', () => {
    expect(buildStatusNote({ indexingCount: 0, failedCount: 0, truncated: false })).toBe('');
  });
  it('reports indexing, failed, and truncation together', () => {
    const note = buildStatusNote({ indexingCount: 2, failedCount: 1, truncated: true });
    expect(note).toMatch(/2 documents are still indexing/i);
    expect(note).toMatch(/1 document failed to index/i);
    expect(note).toMatch(/only the most recent/i);
  });
});

describe('createLibrarySearchTool', () => {
  it('tells the model to upload documents when the library is empty (no RAG call)', async () => {
    mockScope([], 0, 0);
    const libraryTool = await createLibrarySearchTool({ userId: 'user-1' });
    const msg = await invoke(libraryTool);
    expect(searchLibrary).not.toHaveBeenCalled();
    expect(msg.content).toMatch(/no indexed documents/i);
  });

  it('reports "still indexing" when empty but documents are mid-embedding', async () => {
    mockScope([], 2, 0);
    const libraryTool = await createLibrarySearchTool({ userId: 'user-1' });
    const msg = await invoke(libraryTool);
    expect(searchLibrary).not.toHaveBeenCalled();
    expect(msg.content).toMatch(/2 documents are still indexing/i);
  });

  it('passes the ACL scope to searchLibrary and returns content + file_search artifact', async () => {
    mockScope([{ file_id: 'f1', filename: 'lease-romashka.pdf' }], 0, 0);
    searchLibrary.mockResolvedValue({
      content: 'Document: lease-romashka.pdf\nContent: аренда с ООО Ромашка',
      sources: [{ type: 'file', fileId: 'f1', fileName: 'lease-romashka.pdf', content: 'аренда' }],
      documentCount: 1,
    });
    const libraryTool = await createLibrarySearchTool({ userId: 'user-1', fileCitations: true });
    const msg = await invoke(libraryTool);

    const callArgs = searchLibrary.mock.calls[0][0];
    expect(callArgs.fileIds).toEqual(['f1']);
    expect(callArgs.ragApiUrl).toBe('http://rag.internal:8000');
    expect(msg.content).toContain('аренда с ООО Ромашка');
    expect(msg.artifact[Tools.file_search].sources[0].fileId).toBe('f1');
  });

  it('appends a failed-index note to a successful answer', async () => {
    mockScope([{ file_id: 'f1', filename: 'a.pdf' }], 0, 2);
    searchLibrary.mockResolvedValue({
      content: 'Document: a.pdf\nContent: результат',
      sources: [{ type: 'file', fileId: 'f1', fileName: 'a.pdf', content: 'x' }],
      documentCount: 1,
    });
    const libraryTool = await createLibrarySearchTool({ userId: 'user-1' });
    const msg = await invoke(libraryTool);
    expect(msg.content).toContain('результат');
    expect(msg.content).toMatch(/2 documents failed to index/i);
  });

  it('reports "nothing found" when the search returns zero documents', async () => {
    mockScope([{ file_id: 'f1', filename: 'a.pdf' }], 0, 0);
    searchLibrary.mockResolvedValue({ content: '', sources: [], documentCount: 0 });
    const libraryTool = await createLibrarySearchTool({ userId: 'user-1' });
    const msg = await invoke(libraryTool);
    expect(msg.content).toMatch(/no matching documents/i);
  });

  it('degrades gracefully when the search service is unavailable', async () => {
    mockScope([{ file_id: 'f1', filename: 'a.pdf' }], 0, 0);
    searchLibrary.mockRejectedValue(new LibrarySearchUnavailableError('down'));
    const libraryTool = await createLibrarySearchTool({ userId: 'user-1' });
    const msg = await invoke(libraryTool);
    expect(msg.content).toMatch(/temporarily unavailable/i);
  });
});

describe('фильтры по атрибутам (Ф3) — сужение скоупа и структурная безопасность', () => {
  /**
   * Порядок запросов скоупа: getFiles(scope), getFiles(набор по фильтру) и countFiles(indexing),
   * countFiles(failed), countFiles(unfilterable). Отдельного countFiles на набор НЕТ — его размер
   * берётся из длины списка (лишний полный проход по библиотеке того не стоит), а счётчик
   * доплачивается только когда список реально упёрся в кэп.
   */
  function mockFilteredScope(ready, matched, unfilterable = 0) {
    getFiles.mockResolvedValueOnce(ready).mockResolvedValueOnce(matched);
    countFiles
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(unfilterable);
  }

  const META = { docType: 'договор', parties: ['Ромашка'], primaryLocation: 'Минск' };

  it('документ, который нечем проверить, фильтр не выбрасывает — ни без метаданных, ни без ПОЛЯ', async () => {
    /* «Нефильтруемый» — это не только «метаданных нет вовсе». У таблицы никогда нет сторон, у
     * положения нет города, у скана с нераспознанным заголовком тип = «иное». Считай их
     * отфильтрованными — и «покажи все договоры» молча пройдёт мимо, а модель отчитается о
     * полноте, которой нет. */
    mockFilteredScope([{ file_id: 'f1', filename: 'a.pdf', docMetadata: META }], [], 7);
    const scope = await primeLibraryScope('user-1', undefined, { doc_type: 'договор' });

    const [filter] = getFiles.mock.calls[0];
    /* Атрибутные ветки живут во ВТОРОМ элементе $and: первый занят правилом видимости, и оба
     * несут собственный $or — на корне они бы затёрли друг друга. */
    expect(filter.$and[1].$or).toEqual([
      { 'docMetadata.docType': { $regex: '^договор$', $options: 'i' } },
      { docMetadata: { $exists: false } },
      { 'docMetadata.docType': { $in: [null, '', 'иное'] } },
    ]);
    expect(scope.filtered).toBe(true);
    expect(scope.unfilterableCount).toBe(7);
  });

  it('фильтр применяется ПОВЕРХ ACL, а не вместо неё', async () => {
    mockFilteredScope([], []);
    await primeLibraryScope('user-1', 'tenant-1', { org: 'Ромашка' });

    const [filter] = getFiles.mock.calls[0];
    expect(filter.user).toBe('user-1');
    expect(filter.tenantId).toBe('tenant-1');
    expect(filter.project_id).toBeNull();
    expect(filter.embedded).toBe(true);
    expect(filter.$and[0]).toEqual({
      temporary: { $ne: true },
      $or: [{ expiredAt: null }, { temporary: false, expiredAt: { $gt: expect.any(Date) } }],
    });
  });

  it('без фильтров запрос ровно такой же, как до Ф3 (никакого $or)', async () => {
    mockScope([{ file_id: 'f1', filename: 'a.pdf' }]);
    const scope = await primeLibraryScope('user-1');

    expect(getFiles.mock.calls[0][0].$or).toBeUndefined();
    expect(scope.filtered).toBe(false);
    expect(scope.matchedDocuments).toEqual([]);
  });

  it('статус-заметка честно сообщает, что часть библиотеки отфильтровать не удалось', () => {
    const note = buildStatusNote({
      indexingCount: 0,
      failedCount: 0,
      truncated: false,
      filtered: true,
      unfilterableCount: 7,
    });
    expect(note).toContain('7 documents have no extracted metadata');
    expect(note).toContain('searched anyway');
  });

  it('пустой результат фильтра ≠ «документа нет»: модели велено сказать именно это', async () => {
    mockFilteredScope([], []);
    const libraryTool = await createLibrarySearchTool({ userId: 'user-1' });
    const msg = await libraryTool.invoke({
      name: Tools.library_search,
      args: { query: 'аренда', doc_type: 'договор', location: 'Гомель' },
      id: 't1',
      type: 'tool_call',
    });

    expect(msg.content).toContain('do NOT claim the document does not exist');
    expect(msg.content).toContain('kind: договор, city: Гомель');
    expect(searchLibrary).not.toHaveBeenCalled();
  });

  it('размер набора берётся из списка, БЕЗ лишнего прохода по библиотеке', async () => {
    /* Запись File несёт полный текст документа, а `docMetadata.*` идёт residual-фильтром (limit
     * его не подрезает) — значит каждый лишний проход по тому же фильтру стоит десятков МБ
     * чтений. Считать отдельно то, что уже есть в выбранном списке, незачем. */
    const matched = [{ file_id: 'f1', filename: 'a.pdf', docMetadata: META }];
    mockFilteredScope(matched, matched);
    searchLibrary.mockResolvedValue({ content: 'ok', sources: [], documentCount: 1 });

    const libraryTool = await createLibrarySearchTool({ userId: 'user-1' });
    await libraryTool.invoke({
      name: Tools.library_search,
      args: { query: 'все договоры', doc_type: 'договор' },
      id: 't1',
      type: 'tool_call',
    });

    expect(searchLibrary.mock.calls[0][0].matchedTotal).toBe(1);
    // indexing + failed + unfilterable — и ничего на сам набор.
    expect(countFiles).toHaveBeenCalledTimes(3);
  });

  it('перечисление: набор и карточки уходят в поиск для вывода списком', async () => {
    const matched = [
      { file_id: 'f1', filename: 'a.pdf', docMetadata: META },
      { file_id: 'f2', filename: 'b.pdf', docMetadata: META },
    ];
    mockFilteredScope(matched, matched);
    searchLibrary.mockResolvedValue({ content: 'ok', sources: [], documentCount: 2 });

    const libraryTool = await createLibrarySearchTool({ userId: 'user-1' });
    await libraryTool.invoke({
      name: Tools.library_search,
      args: { query: 'все договоры в минске', doc_type: 'договор', location: 'Минск' },
      id: 't1',
      type: 'tool_call',
    });

    const params = searchLibrary.mock.calls[0][0];
    expect(params.matchedTotal).toBe(2);
    expect(params.matchedDocuments).toEqual([
      { fileId: 'f1', filename: 'a.pdf', docMetadata: META },
      { fileId: 'f2', filename: 'b.pdf', docMetadata: META },
    ]);
    expect(params.fileMetadata.get('f1')).toEqual(META);
  });
});
