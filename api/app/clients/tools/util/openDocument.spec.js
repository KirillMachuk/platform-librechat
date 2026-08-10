const { Tools } = require('librechat-data-provider');

/* The slicing/budget core, the schema and the description stay REAL — these tests exercise
 * exactly what the model gets. Only two seams are stubbed: the database, and the tokenizer
 * (its lazy `import()` needs ESM flags Jest does not run with here). 4 chars per token keeps
 * the character maths in the assertions predictable. */
jest.mock('@librechat/api', () => {
  const actual = jest.requireActual('@librechat/api');
  return { ...actual, countTokens: jest.fn((text) => Math.ceil(text.length / 4)) };
});
jest.mock('~/models', () => ({ getFiles: jest.fn() }));

const { countTokens } = require('@librechat/api');
const { getFiles } = require('~/models');
const { createOpenDocumentTool, MAX_OPEN_CALLS_PER_TURN } = require('./openDocument');

const LEASE_TEXT = 'Договор аренды №312/24. 14.7. Односторонний отказ допускается за 30 дней.';

const read = (openTool, args = {}) =>
  openTool.invoke({
    name: Tools.open_document,
    args: { document_id: 'f1', ...args },
    id: 't1',
    type: 'tool_call',
  });

const contentOf = (result) => (typeof result === 'string' ? result : result.content);
const sourcesOf = (result) => result?.artifact?.[Tools.file_search]?.sources;

beforeEach(() => jest.clearAllMocks());

describe('open_document — доступ к документу', () => {
  it('ищет файл ТОЛЬКО в скоупе пользователя: id приходит от модели', async () => {
    getFiles.mockResolvedValueOnce([{ file_id: 'f1', filename: 'lease.pdf', text: LEASE_TEXT }]);

    const openTool = await createOpenDocumentTool({ userId: 'user-1', tenantId: 'tenant-1' });
    await read(openTool);

    const [filter] = getFiles.mock.calls[0];
    expect(filter).toMatchObject({ file_id: 'f1', user: 'user-1', tenantId: 'tenant-1' });
  });

  /* Владение — не единственная граница. Без гейта видимости открывался бы temp-файл из
   * ДРУГОГО чата (обещание «не оставляет следов») и документ с истёкшим ретеншном.
   * Правило то же, что у поиска: withLibraryVisibility, а явно прикреплённый к ЭТОМУ чату
   * файл проходит без гейта (как attachedScope в primeLibraryScope). */
  it('невложенный id открывается ТОЛЬКО под гейтом видимости библиотеки', async () => {
    getFiles.mockResolvedValueOnce([{ file_id: 'f1', filename: 'lease.pdf', text: LEASE_TEXT }]);

    const openTool = await createOpenDocumentTool({ userId: 'user-1' });
    await read(openTool);

    const [filter] = getFiles.mock.calls[0];
    expect(filter.$and).toEqual([expect.objectContaining({ temporary: { $ne: true } })]);
  });

  it('файл, прикреплённый к этому чату, открывается без гейта видимости', async () => {
    getFiles.mockResolvedValueOnce([{ file_id: 'f1', filename: 'lease.pdf', text: LEASE_TEXT }]);

    const openTool = await createOpenDocumentTool({
      userId: 'user-1',
      conversationFileIds: ['f1'],
    });
    await read(openTool);

    const [filter] = getFiles.mock.calls[0];
    expect(filter.$and).toBeUndefined();
    expect(filter).toMatchObject({ file_id: 'f1', user: 'user-1' });
  });

  /* `getFiles` ИСКЛЮЧАЕТ поле `text` по умолчанию (оно тяжёлое, списки его не грузят). Забыть
   * его в проекции — значит вернуть «перезагрузите файл» на КАЖДЫЙ документ, притом что текст
   * в базе есть. Тест держит проекцию. */
  it('запрашивает полный текст явно — иначе он не приедет из Mongo', async () => {
    getFiles.mockResolvedValueOnce([{ file_id: 'f1', filename: 'lease.pdf', text: LEASE_TEXT }]);

    const openTool = await createOpenDocumentTool({ userId: 'user-1' });
    await read(openTool);

    const [, , projection] = getFiles.mock.calls[0];
    expect(projection).toMatchObject({ text: 1 });
  });

  /* Документы RAG-маршрута (большой PDF, источник проекта, вложение в режиме «поиск») текст
   * держат в `fullText` — в `text` его класть НЕЛЬЗЯ, иначе путь вложений начнёт инлайнить
   * весь документ в каждое сообщение. Тул обязан читать оба поля. */
  it('читает документ, у которого текст лежит в fullText (RAG-маршрут)', async () => {
    getFiles.mockResolvedValueOnce([
      { file_id: 'f1', filename: 'big-contract.pdf', fullText: LEASE_TEXT },
    ]);

    const openTool = await createOpenDocumentTool({ userId: 'user-1' });
    const result = await read(openTool);

    expect(contentOf(result)).toContain('big-contract.pdf');
    expect(contentOf(result)).toContain('Односторонний отказ');
  });

  it('запрашивает оба текстовых поля из Mongo', async () => {
    getFiles.mockResolvedValueOnce([{ file_id: 'f1', filename: 'lease.pdf', text: LEASE_TEXT }]);

    const openTool = await createOpenDocumentTool({ userId: 'user-1' });
    await read(openTool);

    const [, , projection] = getFiles.mock.calls[0];
    expect(projection).toMatchObject({ text: 1, fullText: 1 });
  });

  it('инлайн-текст имеет приоритет над fullText', async () => {
    getFiles.mockResolvedValueOnce([
      { file_id: 'f1', filename: 'lease.pdf', text: 'ИНЛАЙН', fullText: 'ПО ТРЕБОВАНИЮ' },
    ]);

    const openTool = await createOpenDocumentTool({ userId: 'user-1' });
    const content = contentOf(await read(openTool));

    expect(content).toContain('ИНЛАЙН');
    expect(content).not.toContain('ПО ТРЕБОВАНИЮ');
  });

  it('чужой или несуществующий документ не открывается', async () => {
    getFiles.mockResolvedValueOnce([]);

    const openTool = await createOpenDocumentTool({ userId: 'user-1' });
    const result = await read(openTool, { document_id: 'someone-elses-file' });

    expect(contentOf(result)).toContain('No document with ID');
    expect(contentOf(result)).not.toContain('Договор аренды');
  });

  it('отдаёт полный текст найденного документа', async () => {
    getFiles.mockResolvedValueOnce([{ file_id: 'f1', filename: 'lease.pdf', text: LEASE_TEXT }]);

    const openTool = await createOpenDocumentTool({ userId: 'user-1' });
    const result = await read(openTool);

    expect(contentOf(result)).toContain('lease.pdf');
    expect(contentOf(result)).toContain('Односторонний отказ');
    expect(contentOf(result)).toContain('end of document');
  });

  /* Исключение, вылетевшее из тула, роняет ВЕСЬ ход чата. Тул обязан деградировать в строку,
   * которую модель перескажет пользователю — так же, как это делает library_search. */
  it('сбой чтения не роняет ход чата, а возвращается сообщением', async () => {
    getFiles.mockResolvedValueOnce([{ file_id: 'f1', filename: 'lease.pdf', text: LEASE_TEXT }]);
    countTokens.mockImplementationOnce(() => {
      throw new Error('tokenizer exploded');
    });

    const openTool = await createOpenDocumentTool({ userId: 'user-1' });
    const result = await read(openTool);

    expect(contentOf(result)).toContain('unexpected error');
  });

  it('сбой обращения к базе тоже не роняет ход чата', async () => {
    getFiles.mockRejectedValueOnce(new Error('mongo down'));

    const openTool = await createOpenDocumentTool({ userId: 'user-1' });
    const result = await read(openTool);

    expect(contentOf(result)).toContain('unexpected error');
  });

  it('пустой document_id не идёт в базу', async () => {
    const openTool = await createOpenDocumentTool({ userId: 'user-1' });
    const result = await read(openTool, { document_id: '   ' });

    expect(getFiles).not.toHaveBeenCalled();
    expect(contentOf(result)).toContain('Document ID');
  });
});

describe('open_document — кэп чтений за ход', () => {
  it('после исчерпания лимита отвечает отказом, не читая базу', async () => {
    getFiles.mockResolvedValue([{ file_id: 'f1', filename: 'lease.pdf', text: LEASE_TEXT }]);

    const openTool = await createOpenDocumentTool({ userId: 'user-1' });
    for (let i = 0; i < MAX_OPEN_CALLS_PER_TURN; i++) {
      await read(openTool);
    }
    const callsAtCap = getFiles.mock.calls.length;
    const overflow = await read(openTool);

    expect(contentOf(overflow)).toContain('Read limit reached');
    expect(getFiles.mock.calls.length).toBe(callsAtCap);
  });

  /* Промах по id — исправимая ошибка модели, а не прочитанный документ: он не стоит ни
   * контекста, ни прохода анонимайзера. Списывать за него слот — значит запереть модель
   * на опечатке. */
  it('неудачные попытки слот не тратят', async () => {
    getFiles.mockResolvedValue([]);

    const openTool = await createOpenDocumentTool({ userId: 'user-1' });
    for (let i = 0; i < MAX_OPEN_CALLS_PER_TURN + 2; i++) {
      const result = await read(openTool, { document_id: 'wrong' });
      expect(contentOf(result)).toContain('No document with ID');
    }
  });

  it('счётчик у каждого запроса свой — ходы не делят лимит', async () => {
    getFiles.mockResolvedValue([{ file_id: 'f1', filename: 'lease.pdf', text: LEASE_TEXT }]);

    const firstTurn = await createOpenDocumentTool({ userId: 'user-1', req: { id: 'r1' } });
    for (let i = 0; i < MAX_OPEN_CALLS_PER_TURN; i++) {
      await read(firstTurn);
    }
    const secondTurn = await createOpenDocumentTool({ userId: 'user-1', req: { id: 'r2' } });
    const result = await read(secondTurn);

    expect(contentOf(result)).toContain('lease.pdf');
    expect(contentOf(result)).not.toContain('Read limit reached');
  });

  /* Регресс на event-driven путь: рантайм пересоздаёт инстансы тулов НА КАЖДЫЙ раунд
   * вызовов внутри одного хода. Счётчик в замыкании инстанса обнулялся бы каждый раунд —
   * кэп обязан жить на объекте запроса и переживать пересоздание. */
  it('кэп переживает пересоздание инстанса в рамках одного запроса', async () => {
    getFiles.mockResolvedValue([{ file_id: 'f1', filename: 'lease.pdf', text: LEASE_TEXT }]);
    const sharedReq = { id: 'streaming-request' };

    const roundOne = await createOpenDocumentTool({ userId: 'user-1', req: sharedReq });
    for (let i = 0; i < MAX_OPEN_CALLS_PER_TURN; i++) {
      await read(roundOne);
    }
    const roundTwo = await createOpenDocumentTool({ userId: 'user-1', req: sharedReq });
    const result = await read(roundTwo);

    expect(contentOf(result)).toContain('Read limit reached');
  });
});

describe('open_document — чтение длинного документа', () => {
  const longText = 'А'.repeat(200000);

  it('длинный документ обрезается и подсказывает, с какого offset продолжить', async () => {
    getFiles.mockResolvedValueOnce([{ file_id: 'f1', filename: 'big.pdf', text: longText }]);

    const openTool = await createOpenDocumentTool({ userId: 'user-1' });
    const content = contentOf(await read(openTool));

    expect(content).toContain('Truncated');
    expect(content).toMatch(/offset \d+/);
  });

  it('offset продолжает чтение с указанного места', async () => {
    getFiles.mockResolvedValue([{ file_id: 'f1', filename: 'big.pdf', text: longText }]);

    const openTool = await createOpenDocumentTool({ userId: 'user-1' });
    const content = contentOf(await read(openTool, { offset: 1000 }));

    expect(content).toContain(`characters 1001-`);
    expect(content).toContain(`of ${longText.length}`);
  });

  /* Совет «перезагрузите файл» для документа, который слишком велик для хранения текста,
   * НЕВЕРЕН — он поедет тем же маршрутом. Модель нужно направить к поиску по нему. */
  it('без текста направляет к поиску по документу, а не в тупик', async () => {
    getFiles.mockResolvedValueOnce([{ file_id: 'f1', filename: 'huge.pdf' }]);

    const openTool = await createOpenDocumentTool({ userId: 'user-1' });
    const content = contentOf(await read(openTool));

    expect(content).toContain('library_search');
    expect(content).toContain('indexed for search only');
  });
});

/* Список источников под ответом собирает СЕРВЕР из фактических чтений, а не модель текстом:
 * подделать его ответом нельзя. Прочитанный документ обязан попасть туда так же, как найденный
 * поиском — иначе «оцени риски договора» отвечает по документу, которого в источниках нет. */
describe('open_document — источники под ответом', () => {
  it('успешное чтение отдаёт РОВНО один источник — тот документ, что прочитан', async () => {
    getFiles.mockResolvedValueOnce([{ file_id: 'f1', filename: 'lease.pdf', text: LEASE_TEXT }]);

    const openTool = await createOpenDocumentTool({ userId: 'user-1' });
    const sources = sourcesOf(await read(openTool));

    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ type: 'file', fileId: 'f1', fileName: 'lease.pdf' });
  });

  it('источник несёт выдержку из прочитанного, а не чужой текст', async () => {
    getFiles.mockResolvedValueOnce([{ file_id: 'f1', filename: 'lease.pdf', text: LEASE_TEXT }]);

    const openTool = await createOpenDocumentTool({ userId: 'user-1' });
    const sources = sourcesOf(await read(openTool));

    expect(LEASE_TEXT.startsWith(sources[0].content)).toBe(true);
  });

  it('документ из fullText (RAG-маршрут) тоже попадает в источники', async () => {
    getFiles.mockResolvedValueOnce([
      { file_id: 'f1', filename: 'big-contract.pdf', fullText: LEASE_TEXT },
    ]);

    const openTool = await createOpenDocumentTool({ userId: 'user-1' });
    const sources = sourcesOf(await read(openTool));

    expect(sources).toHaveLength(1);
    expect(sources[0].fileName).toBe('big-contract.pdf');
  });

  it('чужой id источников не даёт', async () => {
    getFiles.mockResolvedValueOnce([]);

    const openTool = await createOpenDocumentTool({ userId: 'user-1' });
    const result = await read(openTool, { document_id: 'someone-elses-file' });

    expect(sourcesOf(result)).toBeUndefined();
  });

  /* Документ, у которого текста нет, НЕ прочитан. Источник на него означал бы «ответ опирается
   * на этот документ», хотя модель не увидела ни строчки. */
  it('документ без текста в источники не попадает', async () => {
    getFiles.mockResolvedValueOnce([{ file_id: 'f1', filename: 'huge.pdf' }]);

    const openTool = await createOpenDocumentTool({ userId: 'user-1' });

    expect(sourcesOf(await read(openTool))).toBeUndefined();
  });

  /* Offset за концом документа — не чтение: текст уже прочитан ранее и в источниках уже есть,
   * второй раз его туда класть не за что. */
  it('offset за концом документа источник не создаёт', async () => {
    getFiles.mockResolvedValueOnce([{ file_id: 'f1', filename: 'lease.pdf', text: LEASE_TEXT }]);

    const openTool = await createOpenDocumentTool({ userId: 'user-1' });
    const result = await read(openTool, { offset: LEASE_TEXT.length });

    expect(contentOf(result)).toContain('already been read in full');
    expect(sourcesOf(result)).toBeUndefined();
  });

  it('отказ по исчерпанному лимиту источников не даёт', async () => {
    getFiles.mockResolvedValue([{ file_id: 'f1', filename: 'lease.pdf', text: LEASE_TEXT }]);

    const openTool = await createOpenDocumentTool({ userId: 'user-1' });
    for (let i = 0; i < MAX_OPEN_CALLS_PER_TURN; i++) {
      await read(openTool);
    }
    const overflow = await read(openTool);

    expect(contentOf(overflow)).toContain('Read limit reached');
    expect(sourcesOf(overflow)).toBeUndefined();
  });

  it('сбой чтения источников не даёт', async () => {
    getFiles.mockResolvedValueOnce([{ file_id: 'f1', filename: 'lease.pdf', text: LEASE_TEXT }]);
    countTokens.mockImplementationOnce(() => {
      throw new Error('tokenizer exploded');
    });

    const openTool = await createOpenDocumentTool({ userId: 'user-1' });

    expect(sourcesOf(await read(openTool))).toBeUndefined();
  });

  /* Права на цитаты решаются ОДИН раз на запрос и передаются тулу — ровно как у library_search.
   * Иначе «найденный» и «прочитанный» документ подчинялись бы разным правилам. */
  it('прокидывает решение по правам на цитаты в артефакт', async () => {
    getFiles.mockResolvedValue([{ file_id: 'f1', filename: 'lease.pdf', text: LEASE_TEXT }]);

    for (const fileCitations of [true, false]) {
      const openTool = await createOpenDocumentTool({ userId: 'user-1', fileCitations });
      const result = await read(openTool);

      expect(result.artifact[Tools.file_search].fileCitations).toBe(fileCitations);
    }
  });

  /* Каждая часть длинного договора — отдельное чтение, но документ в панели один: клиент
   * схлопывает источники по fileId, поэтому оба чтения обязаны нести ОДИН и тот же id. */
  it('чтение по частям ссылается на один и тот же документ', async () => {
    const longText = 'А'.repeat(200000);
    getFiles.mockResolvedValue([{ file_id: 'f1', filename: 'big.pdf', text: longText }]);

    const openTool = await createOpenDocumentTool({ userId: 'user-1' });
    const first = sourcesOf(await read(openTool));
    const second = sourcesOf(await read(openTool, { offset: 1000 }));

    expect(first[0].fileId).toBe('f1');
    expect(second[0].fileId).toBe('f1');
  });
});
