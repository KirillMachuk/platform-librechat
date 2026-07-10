import { isDrCancelCommand } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';

/**
 * Compact chip that replaces the plain user bubble for the fixed plan-gate command
 * messages (`▶ Начать исследование` / `✕ Отменить исследование`, task #21) — those are
 * button actions, not prose the user typed, so they render as a small status chip.
 */
export default function ActionChip({ text }: { text: string }) {
  const localize = useLocalize();
  const cancelled = isDrCancelCommand(text);
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full bg-surface-secondary px-3 py-1 text-xs text-text-secondary">
      <span aria-hidden="true">{cancelled ? '✕' : '▶'}</span>
      <span>
        {cancelled
          ? localize('com_ui_deep_research_cancelled')
          : localize('com_ui_deep_research_started')}
      </span>
    </div>
  );
}
