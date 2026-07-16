import axios from 'axios';
import FormData from 'form-data';
import { logger } from '@librechat/data-schemas';
import type { TDocIdentifier, TDocMetadata } from 'librechat-data-provider';

/**
 * Извлечение метаданных документа при индексации: `POST RAG_API_URL/metadata` (doc-gateway).
 *
 * Зачем: запросы-перечисления («покажи ВСЕ договоры с X», «брифы за 2025») ретривал решает
 * структурно плохо — top-K не вмещает набор. Замер (RESULTS_META.md): прод-путь dense top-5 =
 * set-recall 0.54, фильтр по этим полям = 1.00 при precision 1.00.
 *
 * Почему у doc-gateway: он единственный видит текст ЛЮБОГО файла ровно один раз (PDF парсит сам —
 * после `/embed` это кэш-хит по SHA-256, скан не распознаётся дважды; docx/csv отдаёт upstream).
 * Порядок чанков в pgvector не восстановить, а у сканов текста нет ни в Mongo, ни у нас
 * (LIBRARY_SEARCH_Phase3_Findings.md §3).
 */

const DEFAULT_TIMEOUT_MS = 60_000;

interface RawIdentifier {
  type?: unknown;
  value?: unknown;
}

interface RawDocMetadata {
  doc_type?: unknown;
  parties?: unknown;
  primary_date?: unknown;
  primary_location?: unknown;
  identifiers?: unknown;
  columns?: unknown;
}

/**
 * Only keys that identify the DOCUMENT. The service also returns contacts and tax ids (it is a
 * generic document parser); those identify parties, are personal data in a model-visible card,
 * and hybrid search already finds them in the text — so they are not stored.
 */
const IDENTIFIER_TYPES: ReadonlySet<string> = new Set(['DOC_NO', 'ARTICLE']);

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function identifiers(value: unknown): TDocIdentifier[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const parsed: TDocIdentifier[] = [];
  for (const item of value as RawIdentifier[]) {
    if (typeof item?.type !== 'string' || typeof item?.value !== 'string') {
      continue;
    }
    if (!IDENTIFIER_TYPES.has(item.type)) {
      continue;
    }
    parsed.push({ type: item.type as TDocIdentifier['type'], value: item.value });
  }
  return parsed;
}

/**
 * Ответ сервиса (snake_case) → хранимая форма. Сервис — обобщённый «разбор документа» и отдаёт
 * шире (сущности/даты/суммы всей зоны); храним только то, что читают фильтр и карточка: частичный
 * список сущностей молча врал бы фильтру, а неиспользуемые поля незачем держать в записи файла.
 */
export function parseDocMetadata(data: unknown): TDocMetadata | null {
  const raw = (data as { doc_metadata?: RawDocMetadata })?.doc_metadata;
  if (!raw || typeof raw !== 'object' || typeof raw.doc_type !== 'string') {
    return null;
  }
  return {
    docType: raw.doc_type,
    parties: strings(raw.parties),
    primaryDate: optionalString(raw.primary_date),
    primaryLocation: optionalString(raw.primary_location),
    identifiers: identifiers(raw.identifiers),
    columns: strings(raw.columns),
  };
}

export interface ExtractDocMetadataParams {
  /** Поток/буфер оригинала — тот же, что уходит в `/embed`. */
  file: NodeJS.ReadableStream | Buffer;
  fileId: string;
  filename: string;
  contentType?: string;
  jwtToken: string;
  ragApiUrl: string;
  timeoutMs?: number;
}

/**
 * Метаданные одного документа. **Fail-open**: любой сбой (сеть, 503 backpressure, кривой ответ)
 * возвращает `null` — файл остаётся полностью искомым, просто без фильтров по атрибутам.
 * Индексация не должна падать из-за метаданных.
 */
export async function extractDocMetadata({
  file,
  fileId,
  filename,
  contentType,
  jwtToken,
  ragApiUrl,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: ExtractDocMetadataParams): Promise<TDocMetadata | null> {
  const formData = new FormData();
  formData.append('file_id', fileId);
  formData.append('file', file, {
    filename,
    contentType: contentType || 'application/octet-stream',
  });

  try {
    const response = await axios.post(`${ragApiUrl}/metadata`, formData, {
      headers: {
        Authorization: `Bearer ${jwtToken}`,
        accept: 'application/json',
        ...formData.getHeaders(),
      },
      timeout: timeoutMs,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    const parsed = parseDocMetadata(response.data);
    if (!parsed) {
      logger.debug(`[docMetadata] ${fileId}: service returned no usable metadata`);
    }
    return parsed;
  } catch (error) {
    logger.warn(
      `[docMetadata] ${fileId}: extraction failed, file stays searchable without attribute filters: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}
