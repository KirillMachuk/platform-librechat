import { isDrCancelCommand } from 'librechat-data-provider';
import { Play, X } from '~/components/icons';
import { useLocalize } from '~/hooks';

/**
 * Compact chip that replaces the plain user bubble for the fixed plan-gate command
 * messages («Начать исследование» / «Отменить исследование», task #21) — those are
 * button actions, not prose the user typed, so they render as a small status chip.
 * Canon icons, not raw glyphs: `▶`/`✕` took the emoji presentation on iOS and a
 * plain shape on desktop (owner 18.08-2).
 */
export default function ActionChip({ text }: { text: string }) {
  const localize = useLocalize();
  const cancelled = isDrCancelCommand(text);
  const Icon = cancelled ? X : Play;
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full bg-surface-secondary px-3 py-1 text-xs text-text-secondary">
      <Icon className="icon-xs" aria-hidden="true" />
      <span>
        {cancelled
          ? localize('com_ui_deep_research_cancelled')
          : localize('com_ui_deep_research_started')}
      </span>
    </div>
  );
}
