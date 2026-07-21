const { logger } = require('@librechat/data-schemas');
const { tool } = require('@librechat/agents/langchain/tools');
const {
  searchLibrary,
  getRagRerankConfig,
  librarySearchSchema,
  generateShortLivedToken,
  getLibrarySearchConfig,
  librarySearchDescription,
  LibrarySearchUnavailableError,
} = require('@librechat/api');
const { Tools } = require('librechat-data-provider');
const { getFiles, countFiles } = require('~/models');

/**
 * Hard cap on how many files enter the library scope in one call. Unbounded, a
 * user with thousands of documents would ship thousands of ids to a single
 * /query_multiple, forcing a sequential distance scan over every chunk. We take
 * the most-recently-updated N (getFiles sorts updatedAt:-1) and tell the model
 * when the library was truncated so it never claims a document is absent.
 */
const LIBRARY_SEARCH_MAX_FILES = parseInt(process.env.LIBRARY_SEARCH_MAX_FILES ?? '', 10) || 1000;

/**
 * Cap on the enumeration list ("show me ALL contracts in Minsk"): a filter can legitimately match
 * hundreds of documents, and every card costs the model tokens. Beyond the cap we still report the
 * true total, so the model says the list is partial instead of implying it is everything.
 */
const LIBRARY_FILTER_LIST_MAX = parseInt(process.env.LIBRARY_FILTER_LIST_MAX ?? '', 10) || 50;

/**
 * Тип, которым извлекатель помечает документ, чей вид определить не удалось (см. `DEFAULT_TYPE`
 * в doc-gateway `app/meta.py`). Для фильтра это НЕ вид документа, а «неизвестно» — иначе скан с
 * нераспознанным заголовком молча выпадал бы из «покажи все договоры».
 */
const DEFAULT_DOC_TYPE = 'иное';

/*
 * Схема и базовое описание тула живут в `@librechat/api` (tools/registry/definitions.ts) —
 * ЕДИНЫЙ источник для event-driven реестра определений и для этого рантайм-инстанса.
 * Локальная копия здесь уже приводила к расхождению: тул вооружался, но реестр его молча
 * выбрасывал (запись отсутствовала) — модель получала ноль инструментов.
 */

/** ISO date (YYYY-MM-DD) — сравнение таких строк лексикографически совпадает с хронологическим. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Дата от модели → значение для сравнения, либо null. Обрезаем пробелы ДО проверки: в JS `$`
 * совпадает и перед завершающим переводом строки, поэтому «2025-01-01\n» прошло бы регэкс и
 * оказалось лексикографически БОЛЬШЕ «2025-01-01» — документ ровно этой датой молча выпал бы
 * из `$gte`-выборки.
 */
const isoDate = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return ISO_DATE.test(trimmed) ? trimmed : null;
};

/** Человекочитаемый пересказ фильтров — модель обязана назвать их пользователю, если ничего не нашлось. */
const describeFilters = ({ doc_type, org, location, date_from, date_to } = {}) =>
  [
    doc_type && `kind: ${doc_type}`,
    org && `party: ${org}`,
    location && `city: ${location}`,
    date_from && `from ${date_from}`,
    date_to && `to ${date_to}`,
  ]
    .filter(Boolean)
    .join(', ');

/** Экранирование пользовательского ввода в regex: значение приходит ОТ МОДЕЛИ (ReDoS/инъекция). */
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Потолок длины значения фильтра. Имя компании или города в это укладывается с запасом, а вот
 * промпт-инъекция («ищи организацию <100k мусора>») иначе превратилась бы в гигантский $regex,
 * который Mongo погонит по всей библиотеке пользователя. Режем, а не отклоняем: усечённое имя
 * по подстроке всё равно найдёт документ, а отказ прятал бы от пользователя его же документы.
 */
const FILTER_VALUE_MAX = 200;

/**
 * Подстрочное совпадение имени, устойчивое к «ё»/«е» и регистру: пользователь пишет «Могилев»
 * или «ромашка», в документе — «Могилёв», «Ромашка Плюс». Подстрока выбрана осознанно: она
 * бережёт recall (замер: фильтр по организации recall 1.00 / precision 0.95 — потери точности
 * только на именах-префиксах «Альфаинвест» ⊂ «Альфаинвест Плюс»).
 */
const looseName = (value) => ({
  $regex: escapeRegex(value.trim().slice(0, FILTER_VALUE_MAX)).replace(/[её]/gi, '[еёЕЁ]'),
  $options: 'i',
});

/**
 * Фильтры модели → условие Mongo по `docMetadata`. Поля ТИПИЗИРОВАНЫ (место ищем среди мест,
 * организацию среди сторон) — замер показал, что общее поле «сущность» ловит «Минск» в
 * организации «Минского городского исполнительного комитета» из тела договора: 33 документа
 * вместо 9, precision 0.38 против 1.00.
 * @returns {object|null} null, если модель не задала ни одного фильтра.
 */
const buildFilterClause = ({ doc_type, org, location, date_from, date_to } = {}) => {
  const clause = {};
  if (typeof doc_type === 'string' && doc_type.trim()) {
    /* Якорное сравнение, но ё-устойчивое: канонические виды пишутся через «ё» («счёт», «отчёт»),
     * а модель, генерируя русский, почти всегда отдаёт «счет» — голое равенство дало бы ноль
     * совпадений и ответ «таких документов нет» поверх полной библиотеки счетов. */
    const value = escapeRegex(doc_type.trim().toLowerCase().slice(0, FILTER_VALUE_MAX));
    clause['docMetadata.docType'] = {
      $regex: `^${value.replace(/[её]/gi, '[еёЕЁ]')}$`,
      $options: 'i',
    };
  }
  if (typeof org === 'string' && org.trim()) {
    clause['docMetadata.parties'] = looseName(org);
  }
  if (typeof location === 'string' && location.trim()) {
    clause['docMetadata.primaryLocation'] = looseName(location);
  }
  const range = {};
  const from = isoDate(date_from);
  const to = isoDate(date_to);
  if (from) {
    range.$gte = from;
  }
  if (to) {
    range.$lte = to;
  }
  if (Object.keys(range).length > 0) {
    clause['docMetadata.primaryDate'] = range;
  }
  return Object.keys(clause).length > 0 ? clause : null;
};

/**
 * Условие «этот документ по этому фильтру проверить НЕЛЬЗЯ» — не только «метаданных нет вовсе»,
 * но и «нужное поле пустое». Разница принципиальная и вскрыта ревью: у таблицы `parties` пуст
 * ВСЕГДА (у CSV нет преамбулы со сторонами), у положения нет города, у скана с нераспознанным
 * заголовком тип = «иное». Считай такие документы отфильтрованными — и «покажи все договоры с
 * Ромашкой» молча пройдёт мимо них, а модель отчитается о полноте, которой нет.
 * @returns {object|null} null, если фильтров нет.
 */
const buildUnfilterableClause = ({ doc_type, org, location, date_from, date_to } = {}) => {
  const gaps = [{ docMetadata: { $exists: false } }];
  if (typeof doc_type === 'string' && doc_type.trim()) {
    gaps.push({ 'docMetadata.docType': { $in: [null, '', DEFAULT_DOC_TYPE] } });
  }
  if (typeof org === 'string' && org.trim()) {
    gaps.push({ 'docMetadata.parties': { $in: [null, []] } });
  }
  if (typeof location === 'string' && location.trim()) {
    gaps.push({ 'docMetadata.primaryLocation': { $in: [null, ''] } });
  }
  if (isoDate(date_from) || isoDate(date_to)) {
    gaps.push({ 'docMetadata.primaryDate': { $in: [null, ''] } });
  }
  return gaps.length > 1 ? { $or: gaps } : null;
};

/**
 * Ограничивает запрос файлами, ВИДИМЫМИ библиотеке. Правило приватности/ретеншна:
 *   1) `temporary: true` — файл temp-чата, в библиотеку не попадает НИКОГДА;
 *   2) без даты `expiredAt` — обычный вечный файл, виден (как и был);
 *   3) `temporary: false` + живая дата — ретеншн-файл (`retentionMode: ALL` даёт срок хранения
 *      КАЖДОМУ файлу): это полноценный документ библиотеки до истечения срока. Правило
 *      «expiredAt: null» здесь молча опустошало всю библиотеку — воспроизведено на лабе;
 *   4) легаси-запись без маркера, но с датой — temp-статус НЕИЗВЕСТЕН → вне библиотеки
 *      (fail-closed: приватность важнее полноты; повторная загрузка файла возвращает его).
 *
 * Оформлено `$and`-обёрткой: и клауза видимости, и фильтры по атрибутам несут собственный
 * `$or`, а два `$or` в одном объекте затирают друг друга object-spread'ом.
 */
const withLibraryVisibility = (query) => {
  const { $or, ...rest } = query;
  const conditions = [
    {
      temporary: { $ne: true },
      $or: [{ expiredAt: null }, { temporary: false, expiredAt: { $gt: new Date() } }],
    },
  ];
  if ($or) {
    conditions.push({ $or });
  }
  return { ...rest, $and: conditions };
};

/**
 * ACL-префильтр: собирает проиндексированные файлы пользователя из его библиотеки.
 * `/query_multiple` (rag_api) авторизации не выполняет — единственная граница доступа
 * это набор file_id, который мы сюда кладём. Собираем строго по `req.user.id`, НИКОГДА
 * не по вводу модели. `embedded: true` = файл реально в pgvector (удаление файла чистит и
 * Mongo, и вектора, поэтому флаг не рассинхронизируется). Файлы шаренных агентов сюда НЕ
 * входят — они ищутся внутри своих агентов (иначе library_search обошёл бы agent-ACL);
 * скоуп = собственные файлы пользователя (решение владельца §7-2).
 *
 * Исключаем: temp-файлы и легаси-записи с датой без маркера (см. `withLibraryVisibility`);
 * `project_id: null` — проектные файлы embedded под
 * своим namespace. `tenantId` (когда известен) — belt-and-suspenders поверх плагина
 * tenant-изоляции: user уже однозначно определяет тенант, но явный фильтр защищает, если
 * ALS-контекст потерян в resumable/SSE-пути (non-strict режим иначе не инжектит фильтр).
 *
 * Фильтры модели (Ф3) сужают скоуп ДО векторного запроса — это бесплатно и отвечает на
 * перечисления, которые ретривал не умеет (замер: dense top-5 set-recall 0.54 vs фильтр 1.00).
 * Они применяются ПОВЕРХ ACL-базы, НИКОГДА вместо неё.
 *
 * **Видимость по ретеншну/приватности** (см. `withLibraryVisibility`): маркер `temporary` — а не
 * дата `expiredAt` — отвечает на вопрос «можно ли файлу в библиотеку». Под `retentionMode: ALL`
 * дату несёт КАЖДЫЙ файл (это срок хранения, документ живой до него), и старое правило
 * «expiredAt: null» молча опустошало всю библиотеку на этом конфиге — ровно это и произошло на
 * лабе. Легаси-записи без маркера остаются под консервативным правилом (дата = вне библиотеки):
 * у них temp-статус неизвестен, а приватность важнее полноты.
 *
 * **Документ без метаданных фильтр НЕ выбрасывает — он просто не фильтруется.** Иначе включение
 * фильтров молча спрятало бы всё, что проиндексировано до Ф3 или где извлечение не удалось:
 * фильтр — жёсткое И, он не самообезвреживается (в отличие от лексического плеча Ф2, которое при
 * промахе просто пустеет). При нулевом покрытии метаданными фильтр = no-op (как сегодня), при
 * полном — точный фильтр; по мере бэкфилла точность растёт сама. Сколько документов не удалось
 * отфильтровать, возвращается в `unfilterableCount` — модель обязана сказать это вслух.
 *
 * @param {string} userId
 * @param {string} [tenantId]
 * @param {object} [filters] `{ doc_type, org, location, date_from, date_to }` от модели.
 * @returns {Promise<{ fileIds: string[]; fileNames: Map<string, string>; indexingCount: number;
 *   failedCount: number; truncated: boolean; filtered: boolean; matchedCount: number;
 *   unfilterableCount: number }>}
 */
const primeLibraryScope = async (userId, tenantId, filters, conversationFileIds = []) => {
  const base = { user: userId, project_id: null };
  if (tenantId != null) {
    base.tenantId = tenantId;
  }
  const filterClause = buildFilterClause(filters);
  const unfilterable = buildUnfilterableClause(filters);
  const scopeQuery = withLibraryVisibility(
    filterClause
      ? { ...base, embedded: true, $or: [filterClause, ...unfilterable.$or] }
      : { ...base, embedded: true },
  );

  /* unfilterable считаем ОТДЕЛЬНЫМ запросом, а не вычитанием из `fileIds`: список обрезан по
   * LIBRARY_SEARCH_MAX_FILES, и арифметика по нему врала бы на большой библиотеке.
   *
   * А вот набор по фильтру берём ОДНИМ запросом вместо «посчитать + выбрать»: это один и тот же
   * фильтр, а запись File несёт полный текст документа, поэтому каждый лишний проход — это
   * десятки МБ чтений (`docMetadata.*` идёт residual-фильтром, limit его не подрезает). Берём на
   * одну запись больше кэпа: пришло меньше — длина и есть полный размер набора, пришло больше —
   * набор реально обрезан, и только тогда доплачиваем счётчиком. */
  /* Documents attached to THIS chat are searched ALONGSIDE the library — the "search files"
   * toggle arms library_search alone, so it must cover attachments too.
   *
   * ACL spine is identical to the library sweep — own files (`user`) plus the tenant
   * belt-and-suspenders — the ids are NEVER trusted blindly. What is deliberately dropped is the
   * `project_id`/visibility gate: the user explicitly attached these to the current chat, so a
   * project-scoped or retention file they attached is in-scope here even though a blind library
   * sweep would exclude it. No metadata filter either — an explicitly attached file stays
   * semantically searchable regardless of doc_type/date.
   *
   * Ids are capped like every other scope query: `applyProjectContext` merges EVERY project
   * source into this same resource slot, so an unbounded `$in` would otherwise reach Mongo from
   * a large project. */
  const attachedIds = Array.isArray(conversationFileIds)
    ? conversationFileIds.slice(0, LIBRARY_SEARCH_MAX_FILES)
    : [];
  const attachedScope =
    attachedIds.length > 0
      ? {
          user: userId,
          ...(tenantId != null ? { tenantId } : {}),
          file_id: { $in: attachedIds },
          embedded: true,
        }
      : null;
  const [ready, indexingCount, failedCount, unfilterableCount, matched, attached] =
    await Promise.all([
      getFiles(
        scopeQuery,
        null,
        { file_id: 1, filename: 1, docMetadata: 1 },
        LIBRARY_SEARCH_MAX_FILES,
      ),
      countFiles(
        withLibraryVisibility({ ...base, embeddingStatus: { $in: ['pending', 'processing'] } }),
      ),
      countFiles(withLibraryVisibility({ ...base, embeddingStatus: 'failed' })),
      unfilterable
        ? countFiles(withLibraryVisibility({ ...base, embedded: true, ...unfilterable }))
        : Promise.resolve(0),
      filterClause
        ? getFiles(
            withLibraryVisibility({ ...base, embedded: true, ...filterClause }),
            null,
            { file_id: 1, filename: 1, docMetadata: 1 },
            LIBRARY_FILTER_LIST_MAX + 1,
          )
        : Promise.resolve([]),
      attachedScope
        ? getFiles(
            attachedScope,
            null,
            { file_id: 1, filename: 1, docMetadata: 1 },
            LIBRARY_SEARCH_MAX_FILES,
          )
        : Promise.resolve([]),
    ]);
  const matchedAll = matched ?? [];
  const matchedTruncated = matchedAll.length > LIBRARY_FILTER_LIST_MAX;
  const matchedCount = matchedTruncated
    ? await countFiles(withLibraryVisibility({ ...base, embedded: true, ...filterClause }))
    : matchedAll.length;
  const readyFiles = ready ?? [];
  const attachedFiles = attached ?? [];
  const fileIds = [];
  const fileNames = new Map();
  const fileMetadata = new Map();
  /* Library scope first, then this chat's attachments; `fileNames` doubles as the dedup set, so a
   * file present in both (an attachment that also lives in the library) is included exactly once. */
  for (const file of [...readyFiles, ...attachedFiles]) {
    if (!file.file_id || fileNames.has(file.file_id)) {
      continue;
    }
    fileIds.push(file.file_id);
    fileNames.set(file.file_id, file.filename ?? 'unknown');
    if (file.docMetadata) {
      fileMetadata.set(file.file_id, file.docMetadata);
    }
  }
  return {
    fileIds,
    fileNames,
    fileMetadata,
    indexingCount,
    failedCount,
    truncated: readyFiles.length >= LIBRARY_SEARCH_MAX_FILES,
    filtered: filterClause != null,
    matchedCount,
    unfilterableCount,
    attachedCount: attachedFiles.length,
    /* Перечисление отдаём набором целиком (решение владельца): выдача ограничена topDocuments,
     * поэтому «покажи ВСЕ договоры в Минске» иначе оборвалось бы на 5 из 9. Лишнюю запись,
     * взятую сверх кэпа только чтобы распознать обрезку, модели не показываем. */
    matchedDocuments: matchedAll
      .slice(0, LIBRARY_FILTER_LIST_MAX)
      .filter((file) => file.file_id)
      .map((file) => ({
        fileId: file.file_id,
        filename: file.filename ?? 'unknown',
        docMetadata: file.docMetadata,
      })),
  };
};

/**
 * Honest status suffix so the model never asserts a document is absent when the
 * library is merely incomplete: some files still indexing, some failed, or the
 * scope was capped. English is intentional — this is a tool→model string; the
 * model relays it to the user in their language.
 */
const buildStatusNote = ({
  indexingCount,
  failedCount,
  truncated,
  filtered,
  unfilterableCount,
}) => {
  const parts = [];
  if (filtered && unfilterableCount > 0) {
    parts.push(
      `${unfilterableCount} document${unfilterableCount > 1 ? 's have' : ' has'} no extracted metadata, so the filter could not be applied to ${unfilterableCount > 1 ? 'them' : 'it'} — ${unfilterableCount > 1 ? 'they were' : 'it was'} searched anyway and may not match the requested attributes`,
    );
  }
  if (indexingCount > 0) {
    parts.push(
      `${indexingCount} document${indexingCount > 1 ? 's are' : ' is'} still indexing and not searchable yet`,
    );
  }
  if (failedCount > 0) {
    parts.push(
      `${failedCount} document${failedCount > 1 ? 's' : ''} failed to index and cannot be searched`,
    );
  }
  if (truncated) {
    parts.push(
      `the library is large so only the most recent ${LIBRARY_SEARCH_MAX_FILES} documents were searched`,
    );
  }
  return parts.length > 0 ? ` (Note: ${parts.join('; ')}.)` : '';
};

/**
 * @param {Object} options
 * @param {string} options.userId
 * @param {string} [options.tenantId]
 * @param {boolean} [options.fileCitations=false]
 * @param {(content: string) => Promise<string>} [options.transformContent] Sovereign anonymizer:
 *   masks the user's document text before it egresses to the model (same seam as file_search).
 * @param {string[]} [options.conversationFileIds] file_ids attached to the current chat, unioned
 *   into the search scope so the one tool covers the library AND this chat's own documents.
 */
const createLibrarySearchTool = async ({
  userId,
  tenantId,
  fileCitations = false,
  transformContent,
  conversationFileIds = [],
}) => {
  return tool(
    async ({ query, doc_type, org, location, date_from, date_to }) => {
      const filters = { doc_type, org, location, date_from, date_to };
      /* Кривую дату нельзя молча проглотить: фильтр не применится, а модель уже решила, что
       * сузила выборку, и подпишет «вот все договоры за 2024» под выдачей за все годы. */
      const badDate = ['date_from', 'date_to'].find(
        (key) => filters[key] != null && filters[key] !== '' && isoDate(filters[key]) === null,
      );
      if (badDate) {
        return [
          `${badDate} "${String(filters[badDate]).slice(0, 40)}" is not a valid date — use ISO YYYY-MM-DD (a whole year = date_from "2024-01-01", date_to "2024-12-31") and call the tool again.`,
          undefined,
        ];
      }
      /* Scope assembly is inside the try like every other step: it hits Mongo, and an escaping
       * exception would abort the whole chat turn instead of degrading to a message the model can
       * relay — the failure mode this tool avoids everywhere else. */
      let scope;
      try {
        scope = await primeLibraryScope(userId, tenantId, filters, conversationFileIds);
      } catch (error) {
        logger.error(`[${Tools.library_search}] scope assembly failed`, error);
        return ['The library search could not be completed due to an unexpected error.', undefined];
      }
      const { fileIds, fileNames } = scope;
      /* PII-safe observability: одна строка на вызов отвечает на «почему ничего не нашлось» —
       * скоуп пуст / всё ещё индексируется / сработал фильтр — без чтения кода и без содержимого
       * запроса. Ровно этой строки не хватило, чтобы диагностировать пустую библиотеку на лабе. */
      logger.info(
        `[${Tools.library_search}] scope: files=${fileIds.length} attached=${scope.attachedCount} indexing=${scope.indexingCount} failed=${scope.failedCount} truncated=${scope.truncated} filtered=${scope.filtered}${scope.filtered ? ` matched=${scope.matchedCount} unfilterable=${scope.unfilterableCount}` : ''} query_chars=${query?.length ?? 0}`,
      );
      const statusNote = buildStatusNote(scope);
      if (fileIds.length === 0) {
        if (scope.filtered) {
          return [
            `No documents in the library match those attributes (${describeFilters(filters)}). Tell the user exactly that — do NOT claim the document does not exist, only that nothing matches these attributes — and offer to search without them.${statusNote}`,
            undefined,
          ];
        }
        const emptyMessage =
          scope.indexingCount > 0 || scope.failedCount > 0
            ? `The user's library has no searchable documents yet.${statusNote} Tell them to retry in a few minutes or re-upload failed files.`
            : 'The user has no indexed documents in their library yet. Tell them to upload documents first.';
        return [emptyMessage, undefined];
      }
      const jwtToken = generateShortLivedToken(userId);
      if (!jwtToken) {
        return ['There was an error authenticating the library search request.', undefined];
      }
      try {
        const result = await searchLibrary({
          ragApiUrl: process.env.RAG_API_URL,
          jwtToken,
          query,
          fileIds,
          fileNames,
          fileMetadata: scope.fileMetadata,
          matchedDocuments: scope.matchedDocuments,
          matchedTotal: scope.matchedCount,
          unfilterableCount: scope.unfilterableCount,
          config: getLibrarySearchConfig(),
          rerankConfig: getRagRerankConfig(),
          fileCitations,
          transformContent,
        });
        if (result.documentCount === 0) {
          if (scope.filtered) {
            return [
              `No matches for these attributes (${describeFilters(filters)}). Do NOT tell the user the document is missing — the filter may be at fault. Retry the search WITHOUT the filters before answering.${statusNote}`,
              undefined,
            ];
          }
          return [
            `No matching documents were found in the library for this query. Suggest the user rephrase or check that the relevant document was uploaded.${statusNote}`,
            undefined,
          ];
        }
        return [
          `${result.content}${statusNote}`,
          { [Tools.file_search]: { sources: result.sources, fileCitations } },
        ];
      } catch (error) {
        if (error instanceof LibrarySearchUnavailableError) {
          return [
            'The library search service is temporarily unavailable. Ask the user to try again shortly.',
            undefined,
          ];
        }
        logger.error(`[${Tools.library_search}] unexpected error`, error);
        return ['The library search could not be completed due to an unexpected error.', undefined];
      }
    },
    {
      name: Tools.library_search,
      responseFormat: 'content_and_artifact',
      description:
        librarySearchDescription +
        (fileCitations
          ? `\n\n**CITE LIBRARY SEARCH RESULTS:** Use the EXACT anchor markers shown in the results (copy them verbatim, e.g. \\ue202turn0file0) immediately after statements derived from a document, and mention the filename in your text. NEVER use markdown links or footnotes.`
          : ''),
      schema: librarySearchSchema,
    },
  );
};

module.exports = {
  createLibrarySearchTool,
  primeLibraryScope,
  withLibraryVisibility,
  buildFilterClause,
  buildUnfilterableClause,
  buildStatusNote,
};
