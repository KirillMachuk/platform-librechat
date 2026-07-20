import { logger } from '@librechat/data-schemas';
import type { TDocMetadata } from 'librechat-data-provider';
import type { RagRerankConfig } from './rerank';
import { rerankOrder } from './rerank';

/**
 * Поиск по всей библиотеке файлов пользователя (в отличие от file_search, который ищет
 * ТОЛЬКО по документам, явно приложенным к чату/агенту/проекту).
 *
 * Отличия от file_search:
 * 1. Скоуп собирается ACL-префильтром на нашей стороне (список разрешённых file_id из Mongo),
 *    а не из tool_resources — rag_api `/query_multiple` авторизации не выполняет.
 * 2. ОДИН запрос `/query_multiple` (фильтр `$in` по file_id) вместо fan-out `/query` на файл —
 *    для сотен документов fan-out недопустим (сотни HTTP-запросов на вызов).
 * 3. Результат группируется ПО ДОКУМЕНТАМ (a "which contract mentions X" запрос → список
 *    документов), а не отдаётся плоским списком чанков.
 *
 * Реранк переиспользует общий хук `rerankOrder` (order-only: меняем ТОЛЬКО порядок, метка
 * Relevance остаётся дистанционной — урок 6 RERANKER_Plan) и общий сервис reranker.
 */

type FetchLike = typeof fetch;

/** Один фрагмент из библиотечного поиска после парсинга ответа `/query_multiple`. */
export interface LibraryChunk {
  /** file_id из МЕТАДАННЫХ чанка (не из запроса — `/query_multiple` смешивает файлы). */
  fileId: string;
  filename: string;
  content: string;
  distance: number;
  page: number | null;
}

/** Документ библиотеки без фрагментов — строка перечисления по фильтру. */
export interface LibraryDocumentRef {
  fileId: string;
  filename: string;
  docMetadata?: TDocMetadata;
}

/** Источник для UI/цитат — та же форма, что у file_search sources. */
export interface LibrarySource {
  type: 'file';
  fileId: string;
  content: string;
  fileName: string;
  relevance: number;
  pages: number[];
  pageRelevance: Record<number, number>;
}

export interface LibrarySearchResult {
  /** Текст для модели, сгруппированный по документам. Пустая строка = ничего не найдено. */
  content: string;
  sources: LibrarySource[];
  /** Число документов в выдаче — обёртка отличает «нет результатов» от наполненного ответа. */
  documentCount: number;
}

export interface LibrarySearchConfig {
  /** Ширина пула кандидатов `/query_multiple` (общий top-k по всей библиотеке). */
  poolSize: number;
  /** Сколько документов вернуть модели. */
  topDocuments: number;
  /** Сколько фрагментов на документ. */
  chunksPerDocument: number;
  /** Таймаут `/query_multiple`; по истечении — ошибка недоступности (fail-loud к обёртке). */
  timeoutMs: number;
  /**
   * Отдельный таймаут реранка. Общий rerankConfig.timeoutMs (дефолт 2500 мс) слишком мал:
   * пул 48 длинных русских чанков на v2-m3 int8 ≈ 3–5 с → 2500 мс всегда бы истекал и
   * реранк тихо становился no-op (fail-open к дистанции). Даём библиотеке свой бюджет.
   */
  rerankTimeoutMs: number;
  /**
   * Базовый URL гибридного ретривера (`services/library-search`: dense + лексика → RRF).
   * Пусто = фича выключена, идём в rag_api напрямую (текущее поведение Ф1).
   *
   * Зачем гибрид (замер, LIBRARY_SEARCH_Phase2_Findings.md): вектор слеп к точным
   * идентификаторам — doc-recall@1 по адресу 0.52 и по номеру договора 0.72 против 1.00
   * у гибрида; итого 0.74 → 0.99 на discovery, без просадки passage-QA (0.41 → 0.47).
   */
  hybridUrl: string | null;
  /** Периметр-токен гибридного сервиса (его API_KEY). */
  hybridToken: string | null;
}

export interface LibrarySearchParams {
  ragApiUrl: string;
  jwtToken: string;
  query: string;
  /** ACL-предочищенный скоуп: только file_id, к которым у пользователя есть доступ. */
  fileIds: string[];
  /** file_id → отображаемое имя (fallback имени и подпись документа). */
  fileNames: Map<string, string>;
  /**
   * file_id → метаданные документа (Ф3) для КАРТОЧКИ в выдаче. Имена файлов сплошь и рядом
   * неинформативны («scan_001.pdf»), и по трём фрагментам модель не отличает похожие документы
   * друг от друга; карточка (тип/стороны/дата/место/№) даёт ей опору. Пусто = карточек нет,
   * выдача как в Ф1.
   */
  fileMetadata?: Map<string, TDocMetadata>;
  /**
   * Документы, отобранные ФИЛЬТРОМ по атрибутам — ответ на перечисления («покажи ВСЕ договоры
   * в Минске»). Перечисление — это НАБОР, а выдача ограничена `topDocuments`, поэтому набор
   * идёт списком карточек ЦЕЛИКОМ, а фрагменты — только у самых релевантных. Без этого
   * измеренный выигрыш фильтра (set-recall 0.54 → 1.00) до пользователя не доходит.
   */
  matchedDocuments?: LibraryDocumentRef[];
  /** Сколько документов совпало с фильтром ВСЕГО (список может быть обрезан). */
  matchedTotal?: number;
  /**
   * Сколько документов по этому фильтру проверить было НЕЧЕМ (нужный атрибут не извлечён).
   * Список набора обязан это признать: иначе модель подпишется под полнотой, которой нет.
   */
  unfilterableCount?: number;
  config: LibrarySearchConfig;
  /** Конфиг реранка (общий с file_search) или null = реранк выключен. */
  rerankConfig: RagRerankConfig | null;
  fileCitations: boolean;
  /**
   * Суверенная маскировка (анонимайзер): маскирует текст документов пользователя (единственная
   * PII-несущая часть, которую видит модель) перед egress. Применяется ТОЛЬКО к model-visible
   * content; артефакт (sources) — UI-only, данные пользователя ему же, остаётся сырым.
   */
  transformContent?: (content: string) => Promise<string>;
  /** Впрыск fetch для тестов; по умолчанию глобальный fetch. */
  fetchImpl?: FetchLike;
}

/**
 * Недоступность rag_api (сеть/таймаут/5xx) — обёртка формирует user-facing сообщение.
 * Пустой результат (404 / ноль чанков) ошибкой НЕ является — это валидное «ничего не найдено».
 */
export class LibrarySearchUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LibrarySearchUnavailableError';
  }
}

function intEnv(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = parseInt(raw ?? '', 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

/** Верхняя граница пула = серверный HARD-cap реранкера (64): шире не имеет смысла. */
const LIBRARY_POOL_MAX = 64;

/**
 * Конфиг из env. Дефолты подобраны под замеры трека реранкера: пул 48 (реранк одного пула
 * v2-m3 int8 ≈ 3–5 с, в бюджете таймаута), 5 документов × 3 фрагмента — компромисс
 * покрытие/шум для document-discovery по best practices (Onyx top-25 чанков, OpenAI top-20).
 */
export function getLibrarySearchConfig(env: NodeJS.ProcessEnv = process.env): LibrarySearchConfig {
  const hybridUrl = env.LIBRARY_SEARCH_HYBRID_URL?.trim();
  return {
    poolSize: intEnv(env.LIBRARY_SEARCH_POOL, 48, 2, LIBRARY_POOL_MAX),
    topDocuments: intEnv(env.LIBRARY_SEARCH_TOP_DOCS, 5, 1, 20),
    chunksPerDocument: intEnv(env.LIBRARY_SEARCH_CHUNKS_PER_DOC, 3, 1, 10),
    timeoutMs: intEnv(env.LIBRARY_SEARCH_TIMEOUT_MS, 30_000, 1_000, 120_000),
    rerankTimeoutMs: intEnv(env.LIBRARY_SEARCH_RERANK_TIMEOUT_MS, 8_000, 500, 30_000),
    hybridUrl: hybridUrl ? hybridUrl.replace(/\/+$/, '') : null,
    hybridToken: env.LIBRARY_SEARCH_HYBRID_TOKEN?.trim() || null,
  };
}

interface QueryMultipleRow {
  page_content?: unknown;
  metadata?: { file_id?: unknown; source?: unknown; page?: unknown };
}

/** Строка ответа rag_api: `[docInfo, distance]`. */
type ResponseRow = [QueryMultipleRow, unknown];

function parseRows(data: unknown, fileNames: Map<string, string>): LibraryChunk[] {
  if (!Array.isArray(data)) {
    return [];
  }
  const chunks: LibraryChunk[] = [];
  for (const row of data as ResponseRow[]) {
    const docInfo = row?.[0];
    const content = docInfo?.page_content;
    const fileId = docInfo?.metadata?.file_id;
    if (typeof content !== 'string' || typeof fileId !== 'string') {
      continue;
    }
    const distance = typeof row[1] === 'number' ? row[1] : Number.POSITIVE_INFINITY;
    const source = docInfo.metadata?.source;
    const sourceName = typeof source === 'string' ? source.split('/').pop() : undefined;
    const page = typeof docInfo.metadata?.page === 'number' ? docInfo.metadata.page : null;
    chunks.push({
      fileId,
      // Prefer the library's own filename (what the user sees in «Files») over the
      // pgvector `source`, which can be a doc-gateway `<name>.md` or a storage path.
      filename: fileNames.get(fileId) || sourceName || 'unknown',
      content,
      distance,
      page,
    });
  }
  return chunks;
}

/** Куда идём за пулом кандидатов: штатный rag_api (dense) или наш гибрид (dense+лексика→RRF). */
interface RetrievalEndpoint {
  url: string;
  token: string;
  /** hybrid → порядок строк = RRF и его НЕЛЬЗЯ пересортировывать по дистанции. */
  kind: 'dense' | 'hybrid';
}

/**
 * ОДИН запрос `/query_multiple` по ACL-собранному скоупу. Бросает LibrarySearchUnavailableError
 * при сетевом сбое/таймауте/5xx; 404 (rag_api отдаёт его на пустой результат) → [] (не ошибка).
 *
 * Гибридный сервис намеренно повторяет путь и форму ответа rag_api, поэтому здесь меняется
 * только базовый URL и токен — парсинг общий.
 */
async function queryMultiple(
  params: LibrarySearchParams,
  endpoint: RetrievalEndpoint,
): Promise<LibraryChunk[]> {
  const { query, fileIds, config, fileNames, fetchImpl = fetch } = params;
  let response: Response;
  try {
    response = await fetchImpl(`${endpoint.url}/query_multiple`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${endpoint.token}`,
      },
      // No entity_id: unlike /query, rag_api's /query_multiple filters purely by
      // {file_id: {$in}} in the single shared collection (verified in rag_api
      // document_routes), so a globally-unique file_id is found regardless of the
      // namespace it was embedded under — and it does NO auth (ACL is enforced by
      // primeLibraryScope building this file_ids set from the user's own files).
      body: JSON.stringify({ query, file_ids: fileIds, k: config.poolSize }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    logger.warn(`[rag/library] ${endpoint.kind} /query_multiple unreachable (${reason})`);
    throw new LibrarySearchUnavailableError('library search service unreachable');
  }
  if (response.status === 404) {
    return [];
  }
  if (!response.ok) {
    logger.warn(`[rag/library] ${endpoint.kind} /query_multiple HTTP ${response.status}`);
    throw new LibrarySearchUnavailableError(`library search service HTTP ${response.status}`);
  }
  const data = (await response.json()) as unknown;
  const parsed = parseRows(data, fileNames);
  // Warn on a non-empty body that parsed to nothing — otherwise a response-shape
  // change reads as a genuine "no results" and hides the real failure.
  if (Array.isArray(data) && data.length > 0 && parsed.length === 0) {
    logger.warn(
      `[rag/library] /query_multiple returned ${data.length} rows but none parsed — response shape may have changed`,
    );
  }
  // Defense-in-depth cap: never carry more than the pool downstream even if the
  // server ignores `k` and over-returns (a huge array would OOM the rerank JSON).
  return parsed.slice(0, params.config.poolSize);
}

/**
 * Дистанция → релевантность для метки модели (честная per-chunk оценка ретривера, урок 6).
 * Нечисловая дистанция (кривой ответ rag_api) дала бы `Relevance: -Infinity` в промпте —
 * возвращаем 0, чтобы модель не видела мусор.
 */
function relevanceOf(chunk: LibraryChunk): number {
  return Number.isFinite(chunk.distance) ? 1 - chunk.distance : 0;
}

/**
 * Группировка ранжированных чанков по документам с сохранением порядка (лучший фрагмент
 * определяет позицию документа — «max score per doc»). Берём topDocuments документов,
 * каждому гарантируем до chunksPerDocument лучших фрагментов.
 *
 * `chunksPerDocument` — это ГАРАНТИЯ на документ, а не жёсткий потолок: общий бюджет выдачи
 * (`topDocuments * chunksPerDocument`, тот же, что и раньше) после раздачи гарантий
 * распределяется по документам в порядке релевантности. Когда выдача схлопывается в один
 * документ («что сказано в договоре с Ромашкой про расторжение»), он получает всю глубину
 * вместо трёх фрагментов, а остальные 45 чанков пула больше не выбрасываются впустую.
 * Выдача из topDocuments документов побайтово совпадает с прежней — потолок токенов не растёт.
 */
function groupByDocument(
  rankedChunks: LibraryChunk[],
  topDocuments: number,
  chunksPerDocument: number,
): LibraryChunk[][] {
  const byDoc = new Map<string, LibraryChunk[]>();
  /** Чанки сверх гарантии, в порядке релевантности — источник для добора из общего бюджета. */
  const spare = new Map<string, LibraryChunk[]>();

  for (const chunk of rankedChunks) {
    const existing = byDoc.get(chunk.fileId);
    if (existing) {
      if (existing.length < chunksPerDocument) {
        existing.push(chunk);
      } else {
        const extra = spare.get(chunk.fileId);
        if (extra) {
          extra.push(chunk);
        } else {
          spare.set(chunk.fileId, [chunk]);
        }
      }
      continue;
    }
    if (byDoc.size >= topDocuments) {
      continue;
    }
    byDoc.set(chunk.fileId, [chunk]);
  }

  let remaining = topDocuments * chunksPerDocument;
  for (const chunks of byDoc.values()) {
    remaining -= chunks.length;
  }
  if (remaining > 0) {
    /* Map сохраняет порядок вставки = порядок релевантности документов, поэтому добор идёт
     * сверху вниз: самый релевантный документ раскрывается первым. */
    for (const [fileId, chunks] of byDoc) {
      const extra = spare.get(fileId);
      if (!extra) {
        continue;
      }
      const take = Math.min(remaining, extra.length);
      for (let i = 0; i < take; i++) {
        chunks.push(extra[i]);
      }
      remaining -= take;
      if (remaining === 0) {
        break;
      }
    }
  }
  return [...byDoc.values()];
}

/**
 * Потолки на перечни внутри карточки: карточка — опора для модели, а не оглавление документа.
 * У нормативки десятки статей, у таблицы — до сорока колонок, и всё это множится на список
 * набора (до `LIBRARY_FILTER_LIST_MAX` карточек) в каждом вызове тула.
 */
const CARD_ARTICLES_MAX = 5;
const CARD_COLUMNS_MAX = 10;
const CARD_PARTIES_MAX = 6;
/**
 * Ограничиваем и ДЛИНУ элемента, не только их число: у колонки CSV длина ничем не ограничена, и
 * замер даёт 10 колонок по 59 знаков = 15 650 токенов на список из 50 карточек против 3 650 с
 * короткими. Стороны своё ограничение уже имеют (юрформа рубит имя на 60 знаках).
 */
const CARD_VALUE_CHARS = 40;

/** Перечень для карточки: не длиннее `max`, с честным «…», если что-то не показано. */
const capped = (values: string[], max: number): string => {
  const shown = values
    .slice(0, max)
    .map((v) => (v.length > CARD_VALUE_CHARS ? `${v.slice(0, CARD_VALUE_CHARS)}…` : v));
  return `${shown.join(', ')}${values.length > max ? ', …' : ''}`;
};

/**
 * Карточка документа: чем документ является, кто стороны, когда и где составлен, его номер.
 *
 * Зачем модели: имена файлов сплошь и рядом неинформативны («scan_001.pdf», «Договор_2_Финал»),
 * а три фрагмента из середины не дают отличить один похожий договор от другого — карточка даёт
 * опору. Данные уже извлечены при индексации, так что она бесплатна.
 *
 * Метки английские (это строка тул→модель, как соседние `Relevance:`/`Content:`), значения —
 * как в документе. Пустые поля опускаем: «Parties: —» модель прочитает как «сторон нет», хотя
 * на деле они просто не извлеклись.
 */
function renderCard(meta: TDocMetadata | undefined): string {
  if (!meta) {
    return '';
  }
  const parts: string[] = [];
  if (meta.docType) {
    parts.push(`Type: ${meta.docType}`);
  }
  if (meta.parties?.length) {
    parts.push(`Parties: ${capped(meta.parties, CARD_PARTIES_MAX)}`);
  }
  if (meta.primaryDate) {
    parts.push(`Date: ${meta.primaryDate}`);
  }
  if (meta.primaryLocation) {
    parts.push(`Place: ${meta.primaryLocation}`);
  }
  const docNo = meta.identifiers?.find((id) => id.type === 'DOC_NO')?.value;
  if (docNo) {
    parts.push(`No: ${docNo}`);
  }
  const articles = meta.identifiers?.filter((id) => id.type === 'ARTICLE') ?? [];
  if (articles.length) {
    parts.push(
      `Articles: ${capped(
        articles.map((id) => id.value),
        CARD_ARTICLES_MAX,
      )}`,
    );
  }
  if (meta.columns?.length) {
    parts.push(`Columns: ${capped(meta.columns, CARD_COLUMNS_MAX)}`);
  }
  return parts.join(' | ');
}

/**
 * Список документов, совпавших с фильтром — ответ на «покажи ВСЕ …». Идёт в тот же `content`,
 * что и фрагменты, поэтому его так же маскирует анонимайзер (имена сторон = ПДн): собери его в
 * обёртке — и он ушёл бы модели сырым.
 *
 * Заголовок УСЛОВНЫЙ, и это не косметика. Заявлять «this list IS the complete answer», когда у
 * части библиотеки нужный атрибут не извлечён, — значит подписать модель под полнотой, которой
 * нет: у таблицы никогда нет сторон, у скана с провалившимся OCR нет ничего. Юрист по такому
 * ответу решит, что договоров два, хотя непроверенными остались двести.
 */
function formatMatchedList(
  documents: LibraryDocumentRef[],
  total: number,
  unfilterableCount = 0,
): string {
  if (documents.length === 0) {
    return '';
  }
  const lines = documents.map((doc, index) => {
    const card = renderCard(doc.docMetadata);
    return `${index + 1}. ${doc.filename}${card ? ` — ${card}` : ''} — Document ID: ${doc.fileId}`;
  });
  const truncated = total > documents.length;
  const head = truncated
    ? `Documents whose extracted attributes match — showing the ${documents.length} most recently updated of ${total}. ALWAYS tell the user the list is partial and give the total (${total}); ask them to narrow the filter to see the rest.`
    : `Documents whose extracted attributes match (${total}).`;

  let completeness = '';
  if (unfilterableCount > 0) {
    completeness = ` WARNING: ${unfilterableCount} other document${unfilterableCount > 1 ? 's have' : ' has'} no extracted value for the filtered attribute and could NOT be checked — this list is NOT the full answer. Say that it covers only documents with known attributes.`;
  } else if (!truncated) {
    completeness = ` This list IS the complete answer to "show me all …" questions — do not narrow it to the passages below.`;
  }

  const passages =
    unfilterableCount > 0
      ? `Passages from across the library (may include documents NOT in the list above):`
      : `Passages from the most relevant of them:`;
  return `${head}${completeness}\n${lines.join('\n')}\n\n${passages}`;
}

function formatResult(
  groups: LibraryChunk[][],
  fileCitations: boolean,
  fileMetadata?: Map<string, TDocMetadata>,
): { content: string; sources: LibrarySource[] } {
  const sources: LibrarySource[] = [];
  const blocks: string[] = [];
  let citationIndex = 0;
  for (const group of groups) {
    const filename = group[0]?.filename ?? 'unknown';
    const card = renderCard(fileMetadata?.get(group[0]?.fileId ?? ''));
    const chunkLines = group.map((chunk) => {
      const relevance = relevanceOf(chunk);
      const anchor = fileCitations
        ? `\nAnchor: \\ue202turn0file${citationIndex} (${filename})`
        : '';
      sources.push({
        type: 'file',
        fileId: chunk.fileId,
        content: chunk.content,
        fileName: filename,
        relevance,
        pages: chunk.page ? [chunk.page] : [],
        pageRelevance: chunk.page ? { [chunk.page]: relevance } : {},
      });
      citationIndex += 1;
      return `${anchor}\nRelevance: ${relevance.toFixed(4)}\nContent: ${chunk.content}`;
    });
    /* The stable handle for the second step: passages are excerpts, so when the user asks about
     * one of these documents in depth the model needs an id to pass to open_document. */
    const documentId = group[0]?.fileId ?? '';
    blocks.push(
      `Document: ${filename}${card ? `\n${card}` : ''}\nDocument ID: ${documentId}${chunkLines.join('\n')}`,
    );
  }
  return { content: blocks.join('\n\n---\n\n'), sources };
}

/**
 * Пул кандидатов: гибрид (dense+лексика→RRF), если включён, иначе штатный dense rag_api.
 *
 * Fail-open к dense на ЛЮБОМ сбое гибрида — ровно как реранк не может сломать поиск: новый
 * сервис не должен становиться новой точкой отказа. Пустой ответ гибрида сбоем НЕ считается
 * (это валидное «ничего не найдено»), иначе на каждый промах шёл бы второй запрос.
 */
async function retrieve(
  params: LibrarySearchParams,
): Promise<{ chunks: LibraryChunk[]; kind: 'dense' | 'hybrid' }> {
  const { config, ragApiUrl, jwtToken } = params;
  const dense: RetrievalEndpoint = { url: ragApiUrl, token: jwtToken, kind: 'dense' };
  if (!config.hybridUrl) {
    return { chunks: await queryMultiple(params, dense), kind: 'dense' };
  }
  try {
    const chunks = await queryMultiple(params, {
      url: config.hybridUrl,
      token: config.hybridToken ?? '',
      kind: 'hybrid',
    });
    return { chunks, kind: 'hybrid' };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.warn(`[rag/library] hybrid retriever unavailable (${reason}) — fail-open to dense`);
    return { chunks: await queryMultiple(params, dense), kind: 'dense' };
  }
}

/**
 * Оркестрация библиотечного поиска: retrieve (широкий пул) → rerank (order-only, fail-open)
 * → группировка по документам → форматирование → маскировка выдачи.
 */
export async function searchLibrary(params: LibrarySearchParams): Promise<LibrarySearchResult> {
  const {
    fileIds,
    query,
    config,
    rerankConfig,
    fileCitations,
    transformContent,
    fileMetadata,
    matchedDocuments,
    matchedTotal,
    unfilterableCount,
  } = params;
  const empty: LibrarySearchResult = { content: '', sources: [], documentCount: 0 };
  if (fileIds.length === 0) {
    return empty;
  }

  /* Список набора не зависит от ретривала — он и нужен там, где top-K не справляется. */
  const list = matchedDocuments?.length
    ? formatMatchedList(
        matchedDocuments,
        matchedTotal ?? matchedDocuments.length,
        unfilterableCount,
      )
    : '';

  const { chunks, kind } = await retrieve(params);
  if (chunks.length === 0) {
    /* Ноль фрагментов ещё не значит «ничего нет»: фильтр мог отобрать документы, у которых
     * просто не нашлось похожего пассажа (или вектора части файлов потеряны). Выбросить здесь
     * готовый набор — значит ответить «ничего не найдено» ровно в том сценарии, ради которого
     * Ф3 и делалась. */
    if (!list) {
      return empty;
    }
    const listOnly = transformContent ? await transformContent(list) : list;
    return { content: listOnly, sources: [], documentCount: matchedDocuments?.length ?? 0 };
  }

  // Гибрид отдаёт строки в порядке RRF — пересортировка по дистанции его бы уничтожила
  // (лексическая находка с точным совпадением по номеру договора почти всегда дальше по
  // косинусу, чем «похожий» боилерплейт). Порядок нужен на случай, когда реранк не сработал:
  // тогда выдача остаётся ранжированной RRF, а не дистанцией.
  let ranked =
    kind === 'hybrid' ? chunks.slice() : chunks.slice().sort((a, b) => a.distance - b.distance);
  if (rerankConfig && ranked.length > 1) {
    const order = await rerankOrder({
      // Library-specific timeout: a wide pool of long RU chunks needs more than the
      // shared 2500 ms default, or the rerank silently times out to distance order.
      config: { ...rerankConfig, timeoutMs: config.rerankTimeoutMs },
      query,
      documents: ranked.map((chunk) => chunk.content),
      topN: ranked.length,
      fetchImpl: params.fetchImpl,
    });
    if (order != null) {
      // Order-only: reorder by the reranked positions, but APPEND any pool chunk the
      // reranker didn't return (server top_n cap / dropped indices) so the tail is
      // never lost — grouping still needs every candidate document.
      const seen = new Set(order.map((o) => o.index));
      const reordered = order.map(({ index }) => ranked[index]);
      for (let i = 0; i < ranked.length; i++) {
        if (!seen.has(i)) {
          reordered.push(ranked[i]);
        }
      }
      ranked = reordered;
    }
  }

  const groups = groupByDocument(ranked, config.topDocuments, config.chunksPerDocument);
  const { content, sources } = formatResult(groups, fileCitations, fileMetadata);
  /* Список набора склеиваем ДО маскировки: он несёт имена сторон (ПДн), и собери его вызывающий
   * — анонимайзер прошёл бы мимо. Один шов маскировки на всю model-visible выдачу. */
  const full = list ? `${list}\n\n${content}` : content;
  const modelContent = transformContent ? await transformContent(full) : full;
  return { content: modelContent, sources, documentCount: groups.length };
}
