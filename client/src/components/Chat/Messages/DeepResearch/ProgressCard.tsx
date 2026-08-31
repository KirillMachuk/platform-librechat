import { useMemo } from 'react';
import type { ApprovalCardStrings, ApprovalPlanStep } from '~/components/Chat/Cards/ApprovalCard';
import type { TDeepResearchProgress } from '~/store';
import type { TranslationKeys } from '~/hooks';
import { ApprovalCard, ApprovalCardHeaderAction } from '~/components/Chat/Cards/ApprovalCard';
import RunFooter, { runStatusSteps } from './RunFooter';
import { useChatContext } from '~/Providers';
import { Square } from '~/components/icons';
import { useLocalize } from '~/hooks';

/**
 * The three research phases, shown as a generic checklist when a run has no approved plan
 * (a PROCEED run — the model judged the request clear enough to skip the plan card — emits
 * empty `steps`). Without this the live card collapsed to a bare progress bar. The active
 * phase comes from the snapshot's `phase`, which is a fact the run reports.
 *
 * It never came from the progress fraction, and the note here used to excuse the plan-steps
 * path for doing exactly that — "plan steps are evenly distributed across it". They are not:
 * the fraction is a curve over supervisor rounds, and the first round of a five-step plan
 * landed on step 3 with two ticked off (owner r27). That path now uses a reported index too.
 */
const PHASE_STEPS: { phase: string; key: TranslationKeys }[] = [
  { phase: 'scope', key: 'com_ui_deep_research_phase_scope' },
  { phase: 'research', key: 'com_ui_deep_research_phase_research' },
  { phase: 'report', key: 'com_ui_deep_research_phase_report' },
];

/**
 * The live Deep Research RUNNING card (task #21; r25 package Б).
 *
 * Since r25 it renders through the SAME vendored frame as the plan card the
 * user approved (owner: the two looked like different products): the plan's
 * own steps carry live statuses — check / arrow with a shimmering label /
 * dashed circle — the Stop control sits in the header where the plan card's ✕
 * was, and the current action line plus the progress bar ride the footnote.
 * A step that is being worked on is never hidden behind «Ещё N» (the card
 * auto-expands for it).
 *
 * Driven entirely by the latest `dr_progress` snapshot. `stalled` (offline
 * park / reconnect backoff) swaps the action line for a "waiting for network"
 * notice and freezes the busy animations — a card with no connection must not
 * pulse as if the run were healthy (review r2). The Stop control keeps its
 * ≥40px hit area; the visual circle stays small.
 */
export default function ProgressCard({ data }: { data: TDeepResearchProgress }) {
  const localize = useLocalize();
  const { stopGenerating } = useChatContext();
  const steps: ApprovalPlanStep[] = useMemo(() => {
    /* A PROCEED run has no plan, so the three phases stand in for steps and
     * the ACTIVE one comes from `phase`, not from the coarse fraction:
     * research spans a wide band and a fraction-derived index would mark
     * scope active well into research. */
    const titles = PHASE_STEPS.map((p) => localize(p.key));
    const activeIndex = Math.max(
      0,
      PHASE_STEPS.findIndex((p) => p.phase === data.phase),
    );
    return runStatusSteps(titles, data, activeIndex);
  }, [data, localize]);

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
        todoTitle={localize('com_ui_deep_research_steps')}
        plan={steps}
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
