/**
 * Track B — суверенный Deep Research: маскируем ТОЛЬКО данные пользователя (его
 * вопрос + его документы), но НИКОГДА публичный веб. Как это работает:
 *
 *  1. На старте прогона детектим ПДн в вопросе через POST `/v1/detect {run_id}`.
 *     Карта подстановок (реальные ПДн ↔ плейсхолдеры) остаётся СЕРВЕРНО в
 *     анонимайзере по `run_id` — наружу (в граф, в OpenRouter) она не уходит.
 *  2. Все вызовы моделей графа идут в PASSTHROUGH (заголовки ниже): анонимайзер
 *     их НЕ маскирует, поэтому публичные имена/бренды/веб-контент не глохнут.
 *  3. Вывод file_search (документы юзера) маскируем той же `/v1/detect` — новые
 *     ПДн доливаются в ту же серверную карту прогона.
 *  4. Финальный отчёт восстанавливаем один раз через `/v1/restore` (плейсхолдеры
 *     → реальные ПДн), затем освобождаем карту через `/v1/run/drop`.
 *
 * Фича включается наличием общего секрета `ANON_PASSTHROUGH_TOKEN` (задаётся и на
 * движке, и на анонимайзере). Без него — `startSovereignSession` возвращает null,
 * и DR идёт по легаси-пути (анонимайзер маскирует весь трафик, как раньше). Любой
 * сбой детекта вопроса тоже деградирует прогон в легаси (безопасно: сырые ПДн не
 * утекают, максимум — переусердствуем с маскировкой публичного веба).
 */

type FetchLike = typeof fetch;

interface MinimalLogger {
  warn: (message: string, meta?: unknown) => void;
  error: (message: string, meta?: unknown) => void;
}

/** Подключение к анонимайзеру эндпоинта `1ma`: baseURL (`…/v1`) + клиентский токен. */
export interface AnonymizerConnection {
  /** OpenAI-совместимый base, напр. `http://anon.internal:8000/v1`; detect = `${baseURL}/detect`. */
  baseURL: string;
  /** Клиентский bearer-токен эндпоинта для `Authorization: Bearer …`. */
  apiKey: string;
}

/** Всё, что стороне DR-движка нужно для суверенного прогона (см. модуль-док). */
export interface SovereignSession {
  /** Вопрос пользователя с уже замаскированными ПДн — его и подаём в граф. */
  maskedQuestion: string;
  /**
   * Заголовки passthrough на КАЖДЫЙ вызов модели графа (анонимайзер не маскирует
   * → публичный веб/деривативы не глохнут). Мержить в `configOptions.defaultHeaders`.
   */
  passthroughHeaders: Readonly<Record<string, string>>;
  /**
   * Маскирует текст документа юзера (вывод file_search) в ту же карту прогона.
   * ОТКЛОНЯЕТСЯ при сбое — вызывающий НЕ должен слать сырой текст наружу (в
   * passthrough анонимайзер его не прикроет), а обязан отбросить этот фрагмент.
   */
  maskContent(text: string): Promise<string>;
  /**
   * Восстанавливает плейсхолдеры финального отчёта в реальные ПДн. НИКОГДА не
   * бросает: при сбое/протухшем прогоне возвращает вход как есть (в отчёте
   * останутся плейсхолдеры — некрасиво, но без утечки). Использует только
   * тайм-аут, НЕ abort прогона: отчёт (в т.ч. частичный после Stop) обязан
   * дешифроваться даже когда прогон уже прерван.
   */
  restore(text: string): Promise<string>;
  /** Досрочно освобождает серверную карту прогона (best-effort, не бросает). */
  drop(): Promise<void>;
}

export interface StartSovereignSessionParams {
  /** Подключение к анонимайзеру; null/неполное → сессия не стартует (легаси-путь). */
  connection: AnonymizerConnection | null | undefined;
  /** Стабильный id прогона (streamId ?? responseMessageId) — ключ серверной карты. */
  runId: string;
  /** Общий секрет passthrough (env `ANON_PASSTHROUGH_TOKEN`); пусто → фича выключена. */
  passthroughToken: string | null | undefined;
  /** Исходный вопрос пользователя (его и маскируем на старте). */
  question: string;
  /** Abort прогона — отменяет detect'ы в полёте, если пользователь нажал Stop. */
  signal?: AbortSignal;
  /** Впрыск fetch для тестов; по умолчанию глобальный fetch. */
  fetchImpl?: FetchLike;
  logger?: MinimalLogger;
}

/** Тайм-ауты на обращения к анонимайзеру (мс). Детект щедрее — большие договоры медленные. */
const DETECT_TIMEOUT_MS = 45_000;
const RESTORE_TIMEOUT_MS = 30_000;
const DROP_TIMEOUT_MS = 8_000;

const PASSTHROUGH_HEADER = 'X-Anon-Passthrough';
const PASSTHROUGH_TOKEN_HEADER = 'X-Anon-Passthrough-Token';

/** Заголовки, которыми движок просит анонимайзер пропустить вызов модели без маскировки. */
export function sovereignPassthroughHeaders(passthroughToken: string): Record<string, string> {
  return { [PASSTHROUGH_HEADER]: '1', [PASSTHROUGH_TOKEN_HEADER]: passthroughToken };
}

/** `${baseURL}/${path}` без задвоения слэша на стыке. */
function anonUrl(baseURL: string, path: string): string {
  return `${baseURL.replace(/\/+$/, '')}/${path}`;
}

/** Сигнал = тайм-аут, скомбинированный с abort прогона (если передан). */
function withTimeout(timeoutMs: number, runSignal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return runSignal ? AbortSignal.any([runSignal, timeout]) : timeout;
}

/** POST JSON на анонимайзер с bearer-аутентификацией; бросает на не-2xx/сети. */
async function anonPost(
  fetchImpl: FetchLike,
  url: string,
  apiKey: string,
  body: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    throw new Error(`anonymizer ${url} responded ${response.status}`);
  }
  return response.json();
}

/** POST `/v1/detect {run_id, text}` → `masked`. Бросает при сбое или кривом ответе. */
async function detect(
  fetchImpl: FetchLike,
  connection: AnonymizerConnection,
  runId: string,
  text: string,
  signal?: AbortSignal,
): Promise<string> {
  const data = (await anonPost(
    fetchImpl,
    anonUrl(connection.baseURL, 'detect'),
    connection.apiKey,
    { run_id: runId, text },
    withTimeout(DETECT_TIMEOUT_MS, signal),
  )) as { masked?: unknown };
  if (typeof data.masked !== 'string') {
    throw new Error('anonymizer /v1/detect returned no masked text');
  }
  return data.masked;
}

/** POST `/v1/restore {run_id, text}` → `restored`. Не бросает: при сбое отдаёт вход как есть. */
async function restore(
  fetchImpl: FetchLike,
  connection: AnonymizerConnection,
  runId: string,
  text: string,
  logger?: MinimalLogger,
): Promise<string> {
  try {
    const data = (await anonPost(
      fetchImpl,
      anonUrl(connection.baseURL, 'restore'),
      connection.apiKey,
      { run_id: runId, text },
      withTimeout(RESTORE_TIMEOUT_MS),
    )) as { restored?: unknown };
    return typeof data.restored === 'string' ? data.restored : text;
  } catch (error) {
    logger?.error(
      '[deepResearch:sovereign] restore failed; emitting report with placeholders',
      error,
    );
    return text;
  }
}

/** POST `/v1/run/drop {run_id}`. Best-effort: при сбое карта сама протухнет по TTL. */
async function drop(
  fetchImpl: FetchLike,
  connection: AnonymizerConnection,
  runId: string,
  logger?: MinimalLogger,
): Promise<void> {
  try {
    await anonPost(
      fetchImpl,
      anonUrl(connection.baseURL, 'run/drop'),
      connection.apiKey,
      { run_id: runId },
      withTimeout(DROP_TIMEOUT_MS),
    );
  } catch (error) {
    logger?.warn('[deepResearch:sovereign] run/drop failed (map will TTL-expire)', error);
  }
}

/**
 * Стартует суверенную сессию: маскирует вопрос один раз и, при успехе, отдаёт
 * сессию для passthrough-заголовков, маскировки file_search и восстановления
 * финала. Возвращает null (→ легаси полный-маск путь), если фича выключена
 * (нет токена/подключения) ИЛИ детект вопроса сорвался. Сам НИКОГДА не бросает.
 */
export async function startSovereignSession(
  params: StartSovereignSessionParams,
): Promise<SovereignSession | null> {
  const { connection, runId, passthroughToken, question, signal, logger } = params;
  const fetchImpl = params.fetchImpl ?? fetch;

  if (!passthroughToken || !connection?.baseURL || !connection.apiKey || !runId) {
    return null;
  }

  let maskedQuestion: string;
  try {
    maskedQuestion = await detect(fetchImpl, connection, runId, question, signal);
  } catch (error) {
    logger?.warn(
      '[deepResearch:sovereign] question masking failed; running this DR under legacy full-masking',
      error,
    );
    return null;
  }

  return {
    maskedQuestion,
    passthroughHeaders: sovereignPassthroughHeaders(passthroughToken),
    maskContent: (text: string) => detect(fetchImpl, connection, runId, text, signal),
    restore: (text: string) => restore(fetchImpl, connection, runId, text, logger),
    drop: () => drop(fetchImpl, connection, runId, logger),
  };
}
