import { logger } from '@librechat/data-schemas';

/**
 * Суверенный реранк RAG-выдачи (фаза 3a плана реранкера).
 *
 * pgvector отдаёт top-k по векторной дистанции — порядок шумный: нужный пункт договора
 * часто на 5-9 месте. Cross-encoder (сервис reranker, схема Jina — тот же контракт, что у
 * webSearch.jinaApiUrl) переупорядочивает кандидатов по паре «вопрос+кусок».
 *
 * Дизайн fail-open: реранк — необязательное УЛУЧШЕНИЕ. Любой сбой (выключен, таймаут,
 * 5xx, кривой ответ) → null → вызывающий остаётся на порядке по дистанции. Никогда не бросает.
 */

type FetchLike = typeof fetch;

export interface RagRerankConfig {
  /** Полный URL Jina-совместимого эндпоинта (http://reranker.railway.internal:8000/v1/rerank). */
  url: string;
  /** Bearer-токен сервиса (= API_KEY реранкера). Пустой = без заголовка (локалка). */
  token: string;
  /**
   * Ширина пула кандидатов: столько чанков запрашивается у rag_api НА ФАЙЛ и столько же
   * (после кросс-файлового мёржа по дистанции) уходит в реранк. Расширение пула — источник
   * качества: реранк только штатных k почти бесполезен (все и так уйдут в контекст).
   */
  candidates: number;
  /** Таймаут вызова реранкера; по истечении — fail-open к порядку по дистанции. */
  timeoutMs: number;
}

export interface RerankedIndex {
  /** Индекс документа во ВХОДНОМ массиве documents. */
  index: number;
  /** relevance_score сервиса (сигмоида, 0..1) — выше = релевантнее. */
  score: number;
}

export interface RerankOrderParams {
  config: RagRerankConfig;
  query: string;
  documents: string[];
  /** Сколько лучших вернуть (top_n сервиса). */
  topN: number;
  signal?: AbortSignal;
  /** Впрыск fetch для тестов; по умолчанию глобальный fetch. */
  fetchImpl?: FetchLike;
}

interface JinaRerankResponse {
  results?: Array<{ index?: unknown; relevance_score?: unknown }>;
}

function intEnv(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = parseInt(raw ?? '', 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

/**
 * Конфиг из env. `RAG_RERANKER_URL` пустой = фича ВЫКЛ (null) — поведение ровно как до неё.
 * Отдельные переменные от webSearch-пути (JINA_API_URL) сознательно: RAG-реранк включается,
 * выключается и указывается на инстанс независимо от веб-поиска.
 */
export function getRagRerankConfig(env: NodeJS.ProcessEnv = process.env): RagRerankConfig | null {
  const url = env.RAG_RERANKER_URL?.trim();
  if (!url) {
    return null;
  }
  return {
    url,
    token: env.RAG_RERANKER_TOKEN?.trim() ?? '',
    // 12, не 36/16: живой прод-замер (qsr, v2-m3 int8, все 8 ядер) = ~0.55с/чанк. Пул 36
    // (кламп RERANKER_MAX_DOCUMENTS=24) = ~13.5с; даже 16 = ~8.8с — а это НЕ влезает в 8с-таймаут
    // library-реранка (LIBRARY_SEARCH_RERANK_TIMEOUT_MS дефолт 8000), так что library молча
    // истекал и откатывался на дистанцию. 12 чанков = ~6.6с, влезает во ВСЕ реранк-таймауты
    // (library 8с, общий 10с) с запасом. Выигрыш реранка идёт с верха пула (промахи в dense-топ-5),
    // поэтому 12 сохраняет переупорядочивание; глубокий отбор жертвуется ради латентности на CPU.
    // Больше пула — только на GPU-реранкере (см. UDA_BENCH_REPORT.md, R6).
    candidates: intEnv(env.RAG_RERANK_CANDIDATES, 12, 2, 64),
    // 10000: пул 12 = ~6.6с одиночно; под конкурентной нагрузкой реранкер сериализует, поднимать
    // env'ом. Слишком низкий дефолт молча ронял бы КАЖДЫЙ реранк в таймаут (незаметно).
    timeoutMs: intEnv(env.RAG_RERANKER_TIMEOUT_MS, 10000, 100, 30_000),
  };
}

function withTimeout(timeoutMs: number, callerSignal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
}

function parseResults(payload: JinaRerankResponse, documentCount: number): RerankedIndex[] | null {
  if (!Array.isArray(payload.results) || payload.results.length === 0) {
    return null;
  }
  const seen = new Set<number>();
  const ranked: RerankedIndex[] = [];
  for (const item of payload.results) {
    const index = typeof item.index === 'number' ? item.index : NaN;
    const score = typeof item.relevance_score === 'number' ? item.relevance_score : NaN;
    if (!Number.isInteger(index) || index < 0 || index >= documentCount || seen.has(index)) {
      continue;
    }
    if (Number.isNaN(score)) {
      continue;
    }
    seen.add(index);
    ranked.push({ index, score });
  }
  return ranked.length > 0 ? ranked : null;
}

/**
 * Переранжировать documents по релевантности query. Возвращает индексы входного массива
 * в новом порядке (лучший первым) с оценками, ЛИБО null при любом сбое (fail-open).
 *
 * `max_documents` в теле — расширение нашего сервиса (Jina его игнорирует): просим сервер
 * поднять кламп до ширины нашего пула, не трогая жёсткий серверный потолок и не влияя на
 * web-путь (тот живёт на серверном дефолте).
 */
export async function rerankOrder(params: RerankOrderParams): Promise<RerankedIndex[] | null> {
  const { config, query, documents, topN, signal, fetchImpl = fetch } = params;
  if (documents.length < 2) {
    return null;
  }
  try {
    const response = await fetchImpl(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
      },
      body: JSON.stringify({
        query,
        documents,
        top_n: topN,
        return_documents: false,
        max_documents: documents.length,
      }),
      signal: withTimeout(config.timeoutMs, signal),
    });
    if (!response.ok) {
      logger.warn(`[rag/rerank] reranker HTTP ${response.status} — falling back to distance order`);
      return null;
    }
    const payload = (await response.json()) as JinaRerankResponse;
    const ranked = parseResults(payload, documents.length);
    if (ranked == null) {
      logger.warn('[rag/rerank] malformed reranker response — falling back to distance order');
    }
    return ranked;
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    logger.warn(`[rag/rerank] reranker unavailable (${reason}) — falling back to distance order`);
    return null;
  }
}
