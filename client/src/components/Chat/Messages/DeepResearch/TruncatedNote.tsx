import type { TMessage } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';

/**
 * True for a Deep Research report whose GATHERING was cut short.
 *
 * The predicate lives here, next to the note it gates, because it has to hold on more than
 * one surface. It was first applied in ContentRender (the chat) and NOT in SearchContent (the
 * public share page), so the same report was a plain note to its author and a red «Не удалось
 * выполнить запрос» to whoever opened the link. Two copies of a rule drift; one exported rule
 * does not.
 *
 * Narrow on purpose: `unfinished` is ALSO set on an ordinary chat answer the user stopped, and
 * both of these surfaces render those too. The runner only sets it for the 'budget'/'rounds'
 * outcomes and both are stamped `drKind: 'report'`, so this loses no case it should catch.
 */
export function isTruncatedDrReport(message?: TMessage | null): boolean {
  return (
    message?.unfinished === true && message.drKind === 'report' && message.isCreatedByUser !== true
  );
}

/**
 * A plain note, deliberately NOT `UnfinishedMessage`.
 *
 * That component wraps the same sentence in `ErrorMessage`, which renders a `role="alert"` red
 * box and prefixes the text with `com_error_generic_prefix` — "Не удалось выполнить запрос.
 * Сообщение об ошибке: …". Over a Deep Research report that is simply false: the report is a
 * real synthesis, written from less material than intended. Announcing it as a failed request
 * is worse than saying nothing.
 */
export default function TruncatedNote() {
  const localize = useLocalize();
  return (
    <div
      className="mt-2 border-l-2 border-border-medium py-0.5 pl-3 text-sm text-text-secondary"
      data-testid="dr-unfinished-notice"
    >
      {localize('com_ui_dr_report_truncated')}
    </div>
  );
}
