import type { TMessage } from 'librechat-data-provider';

/** Max chars scanned for the report's lead heading. */
const TITLE_SCAN_LIMIT = 4000;

/** First H1/H2 text of a markdown report (reports usually lead with one); null otherwise. */
export function extractReportTitle(text: string): string | null {
  const head = String(text ?? '').slice(0, TITLE_SCAN_LIMIT);
  const match = head.match(/^#{1,2}\s+(.+?)\s*$/m);
  if (match == null) {
    return null;
  }
  const title = match[1].replace(/[*_`#]/g, '').trim();
  return title.length > 0 ? title : null;
}

/**
 * Resolves whether an assistant message is a finished Deep Research report and its
 * display title. Review r2: keys on the persisted machine field `message.drKind`
 * ('report', stamped by the runner at creation) — never on display text or an ancestor
 * walk. Prose that merely looks like a report can't grow the card, a PROCEED-direct
 * report (no plan ancestor) now gets the card too, and the per-message O(n) cache walk
 * is gone entirely. Null → ordinary markdown (progressive enhancement: legacy
 * pre-drKind reports and share pages render plain). An empty title is the caller's cue
 * to use a localized fallback.
 */
export function resolveDrReport(
  message: Pick<TMessage, 'isCreatedByUser' | 'text' | 'drKind'>,
): { title: string } | null {
  if (message.isCreatedByUser === true || message.drKind !== 'report') {
    return null;
  }
  const text = message.text ?? '';
  if (text.trim().length === 0) {
    return null;
  }
  return { title: extractReportTitle(text) ?? '' };
}
