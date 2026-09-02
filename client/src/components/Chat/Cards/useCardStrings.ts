import { useMemo } from 'react';
import type { ApprovalCardStrings } from './ApprovalCard';
import { useLocalize } from '~/hooks';

/**
 * The localized strings every ApprovalCard call site hands the card — ONE copy. Three
 * verbatim copies (the questions card, the plan card, the progress card) were finding К1
 * of the 02.09 design review; the r30 change to the contract would have meant editing
 * all three, which is exactly how copies drift.
 */
export default function useCardStrings(): ApprovalCardStrings {
  const localize = useLocalize();
  return useMemo(
    () => ({
      otherPlaceholder: localize('com_ui_cards_other_placeholder'),
      moreLabel: (n) => localize('com_ui_cards_more', { 0: String(n) }),
      lessLabel: localize('com_ui_cards_less'),
      prevQuestion: localize('com_ui_cards_prev_question'),
      nextQuestion: localize('com_ui_cards_next_question'),
      questionOf: (c, t) => localize('com_ui_cards_question_of', { 0: String(c), 1: String(t) }),
      customAnswerFor: (prompt) => localize('com_ui_cards_custom_answer_for', { 0: prompt }),
    }),
    [localize],
  );
}
