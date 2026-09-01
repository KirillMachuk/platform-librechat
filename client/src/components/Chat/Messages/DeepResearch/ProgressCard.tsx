import { useMemo } from 'react';
import type { ApprovalCardStrings } from '~/components/Chat/Cards/ApprovalCard';
import type { TDeepResearchProgress } from '~/store';
import { ApprovalCard, ApprovalCardHeaderAction } from '~/components/Chat/Cards/ApprovalCard';
import { useChatContext } from '~/Providers';
import { Square } from '~/components/icons';
import { useLocalize } from '~/hooks';
import RunFooter from './RunFooter';

/**
 * The live card for a run that carries NO approved plan.
 *
 * It used to fill that emptiness with three constants — «Определение области
 * исследования» / «Исследование источников» / «Формирование отчёта» — laid out
 * in the same well, with the same «Шаги» heading and the same checkmarks as a
 * real plan. The owner read them as HIS plan and they fit any research at all
 * (r28: «вместо реальных шагов подставляются шаблоны, которые подойдут всем
 * DR»). Adding invented content to hide an empty card is the defect, not the
 * cure; the plan gate now always produces a plan and a continuation inherits
 * the one already approved, so this card is the residue — a legacy thread, or a
 * run whose plan could not be recovered. It shows only what it actually knows:
 * what the run is doing now, and how far along it is.
 */
export default function ProgressCard({ data }: { data: TDeepResearchProgress }) {
  const localize = useLocalize();
  const { stopGenerating } = useChatContext();

  const cardStrings: ApprovalCardStrings = useMemo(
    () => ({
      otherPlaceholder: localize('com_ui_cards_other_placeholder'),
      moreLabel: (n) => localize('com_ui_cards_more', { 0: String(n) }),
      lessLabel: localize('com_ui_cards_less'),
      autoApproveBefore: localize('com_ui_cards_autostart_before'),
      autoApproveAfter: localize('com_ui_cards_autostart_after'),
      autoApproveCancelTip: localize('com_ui_cards_cancel_tip'),
      prevQuestion: localize('com_ui_cards_prev_question'),
      nextQuestion: localize('com_ui_cards_next_question'),
      cancelAutoApprove: localize('com_ui_cards_cancel_autostart'),
      questionOf: (c, t) => localize('com_ui_cards_question_of', { 0: String(c), 1: String(t) }),
      customAnswerFor: (prompt) => localize('com_ui_cards_custom_answer_for', { 0: prompt }),
    }),
    [localize],
  );

  return (
    <div className="my-2 w-full">
      <ApprovalCard
        variant="plan"
        strings={cardStrings}
        title={localize('com_ui_deep_research')}
        plan={[]}
        showActions={false}
        headerAction={
          /* The frame's own header slot — same 24px box and 12px inset as the
           * plan card's ✕, which is the whole point of «two cards, one
           * product» (review). It keeps the ≥44px tap height via tap-target. */
          <ApprovalCardHeaderAction
            label={localize('com_ui_deep_research_stop')}
            onClick={stopGenerating}
            testId="dr-stop"
          >
            <Square className="size-3 fill-current" aria-hidden="true" />
          </ApprovalCardHeaderAction>
        }
        footnote={<RunFooter data={data} />}
      />
    </div>
  );
}
