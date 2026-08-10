import type { TDocMetadata } from 'librechat-data-provider';
import { formatDate } from './files';

/**
 * The extractor's word for "I could not tell what this is" (doc-gateway `app/meta.py`
 * DEFAULT_TYPE). It is a placeholder, not a kind of document, so it never reaches a card:
 * labelling a scan "иное" tells the reader nothing they did not already see.
 */
const UNKNOWN_DOC_TYPE = 'иное';

/**
 * Counterparties shown before the list is cut. Two names identify a contract ("Ромашка —
 * Василёк"); past that the line stops being scannable and starts pushing the date off the row.
 */
const CARD_PARTIES_MAX = 2;

/**
 * Потолок длины строки. Он существует не ради вкуса, а ради вёрстки: колонка имени задана
 * через `min-width: 46%`, а таблица раскладывается автоматически — строка в одну линию
 * (`truncate` ставит `white-space: nowrap`) РАСТЯГИВАЕТ колонку вместо того, чтобы обрезаться,
 * и полное юрлицо на 88 знаков уезжало за край панели. Резать здесь, а не менять раскладку
 * общей таблицы: та обслуживает все списки продукта, и её ширины — предмет отдельного трека.
 * Полное значение остаётся в подсказке ряда.
 */
const CARD_MAX_CHARS = 72;

/**
 * One line describing what a document IS, under its own filename — kind, counterparties, and
 * the date it was drawn up, from facts extracted at indexing time.
 *
 * The filename is never replaced by it. People name files the way they search for them, and a
 * generated title would take that away; this only answers the question a name like
 * "Скан_2026_final(3).pdf" leaves open.
 *
 * Absent metadata yields an empty string — every field here is "unknown" rather than "none"
 * on a document the extractor could not read, and a half-filled card would read as fact.
 */
export function buildDocumentCard(meta?: TDocMetadata): string {
  if (!meta) {
    return '';
  }
  const parts: string[] = [];
  const docType = meta.docType?.trim();
  if (docType && docType.toLowerCase() !== UNKNOWN_DOC_TYPE) {
    parts.push(docType.charAt(0).toUpperCase() + docType.slice(1));
  }
  const parties = meta.parties?.filter((party) => party?.trim()) ?? [];
  if (parties.length > 0) {
    parts.push(parties.slice(0, CARD_PARTIES_MAX).join(', '));
  }
  /* The document's own date, formatted like every other date in this list. An unparseable
   * value formats to an empty string and is dropped rather than shown raw. */
  const date = meta.primaryDate ? formatDate(meta.primaryDate) : '';
  if (date) {
    parts.push(date);
  }
  const card = parts.join(' · ');
  return card.length > CARD_MAX_CHARS ? `${card.slice(0, CARD_MAX_CHARS - 1).trimEnd()}…` : card;
}
