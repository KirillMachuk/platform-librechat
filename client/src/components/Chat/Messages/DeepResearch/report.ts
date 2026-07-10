import { isDrPlanMessage, isDrStartCommand, isDrAssistantTurn } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';

/** Max chars scanned for the report's lead heading. */
const TITLE_SCAN_LIMIT = 4000;

type ChainMessage = Pick<TMessage, 'messageId' | 'parentMessageId' | 'isCreatedByUser' | 'text'>;

/** First H1/H2 text of a markdown report (reports always lead with one); null otherwise. */
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
 * Resolves whether an assistant message is a plan-gated Deep Research report and, if so,
 * its display title. Deterministic ancestor check with zero false positives on normal
 * chats: the parent is the exact START command (plan→start), or the parent is a user reply
 * whose own parent is a DR assistant turn — a plan card (plan→edit) or a clarify-questions
 * message (clarify→answer). A lead markdown heading is also required — failure texts
 * (nodata/aborted/cancelled) have none and stay plain. Null on any miss → the message
 * renders as ordinary markdown (progressive enhancement; e.g. a fresh PROCEED-direct report
 * has no DR ancestor, and share pages have no message cache to search — both stay plain).
 */
export function resolveDrReport(
  message: ChainMessage,
  messages: TMessage[] | undefined,
): { title: string } | null {
  if (message.isCreatedByUser === true || !messages?.length || !message.parentMessageId) {
    return null;
  }
  const text = message.text ?? '';
  if (text.trim().length === 0 || isDrPlanMessage(text)) {
    return null;
  }
  const byId = new Map(messages.map((m) => [m.messageId, m]));
  const parent = byId.get(message.parentMessageId);
  if (parent == null || parent.isCreatedByUser !== true) {
    return null;
  }
  let isDrTurn = isDrStartCommand(parent.text ?? '');
  if (!isDrTurn && parent.parentMessageId) {
    const grandparent = byId.get(parent.parentMessageId);
    isDrTurn =
      grandparent != null &&
      grandparent.isCreatedByUser !== true &&
      isDrAssistantTurn(grandparent.text ?? '');
  }
  if (!isDrTurn) {
    return null;
  }
  const title = extractReportTitle(text);
  return title == null ? null : { title };
}
