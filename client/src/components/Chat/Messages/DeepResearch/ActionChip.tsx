import { Play, X } from '~/components/icons';
import { useLocalize } from '~/hooks';

/**
 * Compact chip that replaces the plain user bubble for the fixed plan-gate command
 * messages («Начать исследование» / «Отменить исследование», task #21) — those are
 * button actions, not prose the user typed, so they render as a small status chip.
 * Canon icons, not raw glyphs: `▶`/`✕` took the emoji presentation on iOS and a
 * plain shape on desktop (owner 18.08-2).
 *
 * Takes the decision, not the text: `useDrActionChip` admits the chip on the
 * persisted `drKind` but the caption used to be re-derived from the message text,
 * so a `drKind='cancel'` message whose text was not the cancel marker would have
 * announced «запущено». The caller now owns both halves of that judgement.
 */
export default function ActionChip({ cancelled }: { cancelled: boolean }) {
  const localize = useLocalize();
  const Icon = cancelled ? X : Play;
  return (
    <div
      data-testid="dr-action-chip"
      className="inline-flex items-center gap-1.5 rounded-full bg-surface-secondary px-3 py-1 text-xs text-text-secondary"
    >
      <Icon className="icon-xs" aria-hidden="true" />
      <span>
        {cancelled
          ? localize('com_ui_deep_research_cancelled')
          : localize('com_ui_deep_research_started')}
      </span>
    </div>
  );
}
