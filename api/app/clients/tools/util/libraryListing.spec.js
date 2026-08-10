const { Tools } = require('librechat-data-provider');

/* The listing is rendered by the REAL `listLibrary` — the wording is the whole feature, so a
 * stub would test nothing. Only the network/config seams of the search path are replaced, and
 * `searchLibrary` is kept as a spy precisely so a listing can be proven NOT to call it. */
jest.mock('@librechat/api', () => {
  const actual = jest.requireActual('@librechat/api');
  return {
    listLibrary: actual.listLibrary,
    librarySearchSchema: actual.librarySearchSchema,
    librarySearchDescription: actual.librarySearchDescription,
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
  };
});
jest.mock('~/models', () => ({ getFiles: jest.fn(), countFiles: jest.fn() }));

const { searchLibrary, librarySearchSchema } = require('@librechat/api');
const { getFiles, countFiles } = require('~/models');
const { createLibrarySearchTool } = require('./librarySearch');

const LEASE = { file_id: 'f1', filename: 'Договор аренды.pdf' };
const INVOICE = { file_id: 'f2', filename: 'Счёт №14.pdf' };

/**
 * Mongo calls of one no-filter listing, in the order `primeLibraryScope` issues them:
 * the library sweep, the indexing/failed counters, then the same sweep again as the set to list.
 */
function mockLibrary(documents, { indexing = 0, failed = 0 } = {}) {
  getFiles.mockResolvedValueOnce(documents).mockResolvedValueOnce(documents);
  countFiles.mockResolvedValueOnce(indexing).mockResolvedValueOnce(failed);
}

function ask(libraryTool, args) {
  return libraryTool.invoke({
    name: Tools.library_search,
    args,
    id: 't1',
    type: 'tool_call',
  });
}

const contentOf = (result) => (typeof result === 'string' ? result : result.content);

beforeEach(() => {
  jest.clearAllMocks();
  process.env.RAG_API_URL = 'http://rag.internal:8000';
});

/**
 * «Что у меня вообще есть в библиотеке» — вопрос про то, КАКИЕ документы существуют, а не про
 * то, что в них написано. Раньше запрос был обязателен, и на такой вопрос модель сочиняла
 * запрос («документы») и выдавала пять случайно похожих файлов как содержимое библиотеки.
 */
describe('library_search — перечисление без поискового запроса', () => {
  it('без запроса перечисляет документы и НЕ идёт в поиск', async () => {
    mockLibrary([LEASE, INVOICE]);

    const libraryTool = await createLibrarySearchTool({ userId: 'user-1' });
    const content = contentOf(await ask(libraryTool, {}));

    expect(searchLibrary).not.toHaveBeenCalled();
    expect(content).toContain('Договор аренды.pdf');
    expect(content).toContain('Счёт №14.pdf');
  });

  /* Пустая строка — это тоже «искать нечего»: модель, у которой нет запроса, регулярно шлёт
   * `query: ""` вместо пропуска поля, и векторный поиск по пустоте вернул бы случайный шум. */
  it('пустой запрос считается перечислением, а не поиском по пустоте', async () => {
    mockLibrary([LEASE]);

    const libraryTool = await createLibrarySearchTool({ userId: 'user-1' });
    const content = contentOf(await ask(libraryTool, { query: '   ' }));

    expect(searchLibrary).not.toHaveBeenCalled();
    expect(content).toContain('Договор аренды.pdf');
  });

  it('называет честный размер библиотеки', async () => {
    mockLibrary([LEASE, INVOICE]);

    const libraryTool = await createLibrarySearchTool({ userId: 'user-1' });
    const content = contentOf(await ask(libraryTool, {}));

    expect(content).toContain('2 indexed documents');
  });

  /* Список — не ответ о содержимом. Без этой оговорки модель, спросив список, пересказывает
   * имена файлов как ответ на «что сказано в договоре». */
  it('говорит модели, что список — не ответ о содержимом, и как спросить дальше', async () => {
    mockLibrary([LEASE]);

    const libraryTool = await createLibrarySearchTool({ userId: 'user-1' });
    const content = contentOf(await ask(libraryTool, {}));

    expect(content).toContain('NOT an answer about what any document says');
    expect(content).toContain('call library_search again with a query');
  });

  /* Document ID — это ручка для open_document: без неё «а теперь прочитай второй» упирается в
   * необходимость сначала искать документ, который уже перечислен. */
  it('даёт ручку для чтения каждого перечисленного документа', async () => {
    mockLibrary([LEASE]);

    const libraryTool = await createLibrarySearchTool({ userId: 'user-1' });

    expect(contentOf(await ask(libraryTool, {}))).toContain('Document ID: f1');
  });

  it('на пустой библиотеке зовёт загрузить документы, а не показывает пустой список', async () => {
    mockLibrary([]);

    const libraryTool = await createLibrarySearchTool({ userId: 'user-1' });
    const content = contentOf(await ask(libraryTool, {}));

    expect(content).toContain('no indexed documents');
    expect(searchLibrary).not.toHaveBeenCalled();
  });

  /* Индексация и сбои остаются видимыми: «у тебя 2 документа» поверх десяти ещё не
   * проиндексированных — это неверный ответ на «что у меня есть». */
  it('не скрывает, что часть библиотеки ещё индексируется', async () => {
    mockLibrary([LEASE], { indexing: 3 });

    const libraryTool = await createLibrarySearchTool({ userId: 'user-1' });
    const content = contentOf(await ask(libraryTool, {}));

    expect(content).toContain('3 documents are still indexing');
  });

  it('перечисление не даёт источников — ничего не найдено и не прочитано', async () => {
    mockLibrary([LEASE]);

    const libraryTool = await createLibrarySearchTool({ userId: 'user-1' });
    const result = await ask(libraryTool, {});

    expect(result.artifact).toBeUndefined();
  });
});

describe('library_search — перечисление по фильтру', () => {
  /* «Покажи ВСЕ счета» без вопроса о содержимом: набор берётся фильтром целиком, а не top-K. */
  it('перечисляет набор по фильтру и не идёт в поиск', async () => {
    getFiles.mockResolvedValueOnce([INVOICE]).mockResolvedValueOnce([INVOICE]);
    countFiles.mockResolvedValueOnce(0).mockResolvedValueOnce(0).mockResolvedValueOnce(0);

    const libraryTool = await createLibrarySearchTool({ userId: 'user-1' });
    const content = contentOf(await ask(libraryTool, { doc_type: 'счёт' }));

    expect(searchLibrary).not.toHaveBeenCalled();
    expect(content).toContain('Счёт №14.pdf');
    expect(content).toContain('extracted attributes match');
  });

  it('пустой набор по фильтру не выдаётся за отсутствие документа', async () => {
    getFiles.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    countFiles.mockResolvedValueOnce(0).mockResolvedValueOnce(0).mockResolvedValueOnce(0);

    const libraryTool = await createLibrarySearchTool({ userId: 'user-1' });
    const content = contentOf(await ask(libraryTool, { doc_type: 'счёт' }));

    expect(content).toContain('do NOT claim the document does not exist');
  });
});

describe('library_search — поиск с запросом не изменился', () => {
  it('запрос по-прежнему идёт в поиск, а не в перечисление', async () => {
    getFiles.mockResolvedValueOnce([LEASE]);
    countFiles.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    searchLibrary.mockResolvedValueOnce({
      content: 'Document: Договор аренды.pdf',
      sources: [{ type: 'file', fileId: 'f1' }],
      documentCount: 1,
    });

    const libraryTool = await createLibrarySearchTool({ userId: 'user-1' });
    const result = await ask(libraryTool, { query: 'условия расторжения' });

    expect(searchLibrary).toHaveBeenCalledTimes(1);
    expect(searchLibrary.mock.calls[0][0].query).toBe('условия расторжения');
    expect(contentOf(result)).toContain('Document: Договор аренды.pdf');
    expect(result.artifact[Tools.file_search].sources).toHaveLength(1);
  });

  /* Модель обязана иметь право не передавать запрос — иначе перечисление недостижимо, и
   * рантайм отвергнет вызов до того, как тул о нём узнает. */
  it('схема разрешает вызов без запроса', () => {
    expect(librarySearchSchema.required ?? []).not.toContain('query');
  });
});
