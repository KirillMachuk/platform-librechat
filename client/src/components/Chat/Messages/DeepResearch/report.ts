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

/**
 * True for a Deep Research report whose GATHERING was cut short (budget/round gate).
 *
 * Nothing renders a note for it any more — owner decision, 27.08.2026: a report written
 * from less material is still a real synthesis, and a self-deprecating line under it reads
 * to a client as "this platform is unreliable" far more loudly than it reads as candour.
 * The fact is not lost: the runner still stamps `unfinished` on the message and still logs
 * `finalized reason=budget`, which is where we measure it (`tools/dr_run_metrics`).
 *
 * The predicate itself has to stay, and that is the part worth reading twice. `unfinished`
 * is a GENERAL message flag — an ordinary chat answer the user stopped carries it too — and
 * the surfaces that render it (MessageContent, for plain-text messages; SearchContent, on
 * the share page) turn it into a red `role="alert"` box prefixed «Не удалось выполнить
 * запрос. Сообщение об ошибке: …». Over a report that was written successfully that is
 * simply false, and every truncated report already in the database still carries the flag.
 * A DR report reaches the share page, so this rule is what keeps the box off it there;
 * ContentRender, which renders reports in the chat, has never drawn the box at all.
 */
export function isTruncatedDrReport(
  message?: Pick<TMessage, 'unfinished' | 'drKind' | 'isCreatedByUser'> | null,
): boolean {
  return (
    message?.unfinished === true && message.drKind === 'report' && message.isCreatedByUser !== true
  );
}
