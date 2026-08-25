import { isAskSkipMessage, parseAskAnswersMessage } from 'librechat-data-provider';
import { MessageCircleQuestion, X } from '~/components/icons';
import { useLocalize } from '~/hooks';

/**
 * Compact rendering of the user's answers to an `ask_user` card (interactive
 * cards К3) — button-built messages, not prose, so like the DR ActionChip
 * they render as a chip instead of a bubble. Unlike the DR chip this one
 * keeps the CONTENT visible: each «question — answer» pair on its own line
 * (the static card above no longer shows the selections).
 */
export default function AnswersChip({ text }: { text: string }) {
  const localize = useLocalize();
  if (isAskSkipMessage(text)) {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-full bg-surface-secondary px-3 py-1 text-xs text-text-secondary">
        <X className="icon-xs" aria-hidden="true" />
        <span>{localize('com_ui_cards_questions_skipped')}</span>
      </div>
    );
  }
  const pairs = parseAskAnswersMessage(text);
  return (
    <div className="inline-flex max-w-full flex-col gap-1 rounded-2xl bg-surface-secondary px-3.5 py-2 text-xs text-text-secondary">
      <div className="flex items-center gap-1.5 font-medium">
        <MessageCircleQuestion className="icon-xs" aria-hidden="true" />
        <span>{localize('com_ui_cards_answers_sent')}</span>
      </div>
      {pairs.map((p, i) => (
        <div key={i} className="min-w-0 [overflow-wrap:anywhere]">
          <span className="text-text-tertiary">{p.prompt}</span>
          {' — '}
          <span className="text-text-primary">{p.answer}</span>
        </div>
      ))}
    </div>
  );
}
