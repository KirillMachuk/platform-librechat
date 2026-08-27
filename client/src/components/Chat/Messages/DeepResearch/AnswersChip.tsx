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
      <div
        data-testid="answers-chip"
        className="inline-flex items-center gap-1.5 rounded-full bg-surface-secondary px-3 py-1 text-xs text-text-secondary"
      >
        <X className="icon-xs" aria-hidden="true" />
        <span>{localize('com_ui_cards_questions_skipped')}</span>
      </div>
    );
  }
  const pairs = parseAskAnswersMessage(text);
  return (
    <div
      data-testid="answers-chip"
      /* Same width ceiling as the bubble it replaces (USER_BUBBLE_CLASS): without it a
       * long set of answers stretched the full column — 343px of 343 on a phone,
       * 768 of 768 on desktop — so the same element read as "my reply" when short and
       * as a full-width slab when long, while still sitting under `items-end`.
       * The size follows the reader's message-size setting, like the bubble: this
       * block holds the user's OWN words, and pinning it to 12px handed someone who
       * enlarged text to 20px their own answers in the smallest type on screen. */
      className="inline-flex max-w-[85%] flex-col gap-1 rounded-2xl bg-surface-secondary px-3.5 py-2 text-[length:var(--thinking-font-size)] text-text-secondary md:max-w-[78%]"
    >
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
