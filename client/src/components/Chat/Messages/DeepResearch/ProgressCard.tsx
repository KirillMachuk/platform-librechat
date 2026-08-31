import { useMemo } from 'react';
import { TooltipAnchor } from '@librechat/client';
import type { ApprovalCardStrings, ApprovalPlanStep } from '~/components/Chat/Cards/ApprovalCard';
import type { TDeepResearchProgress } from '~/store';
import type { TranslationKeys } from '~/hooks';
import { ApprovalCard } from '~/components/Chat/Cards/ApprovalCard';
import { Square, WifiOff } from '~/components/icons';
import { useChatContext } from '~/Providers';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/**
 * The three research phases, shown as a generic checklist when a run has no approved plan
 * (a PROCEED run — the model judged the request clear enough to skip the plan card — emits
 * empty `steps`). Without this the live card collapsed to a bare progress bar. The active
 * phase comes from the snapshot's `phase`, NOT the coarse progress fraction: research spans
 * a wide fraction band, so a fraction-derived index would mis-highlight scope as active
 * well into research (the plan-steps path can use the fraction because plan steps are
 * evenly distributed across it; the three phases are not).
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
  const stalled = data.stalled === true;
  const pct = Math.max(0, Math.min(100, Math.round((data.progress ?? 0) * 100)));
  const planSteps = data.steps ?? [];
  const hasPlan = planSteps.length > 0;
  const activeStep = hasPlan
    ? Math.min(Math.floor((data.progress ?? 0) * planSteps.length), planSteps.length - 1)
    : Math.max(
        0,
        PHASE_STEPS.findIndex((p) => p.phase === data.phase),
      );

  const steps: ApprovalPlanStep[] = useMemo(() => {
    const titles = hasPlan ? planSteps : PHASE_STEPS.map((p) => localize(p.key));
    return titles.map((title, i) => {
      let status: ApprovalPlanStep['status'] = 'pending';
      if (i < activeStep) {
        status = 'done';
      } else if (i === activeStep) {
        status = 'active';
      }
      return { id: String(i), title, status };
    });
  }, [hasPlan, planSteps, activeStep, localize]);

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
    <div className="my-2 w-full" data-testid="dr-progress-card">
      <ApprovalCard
        variant="plan"
        strings={cardStrings}
        title={localize('com_ui_deep_research')}
        todoTitle={localize('com_ui_deep_research_steps')}
        plan={steps}
        approveLabel={localize('com_ui_deep_research_start')}
        showActions={false}
        headerAction={
          <TooltipAnchor
            description={localize('com_ui_stop')}
            render={
              <button
                type="button"
                onClick={stopGenerating}
                aria-label={localize('com_ui_stop')}
                data-testid="dr-stop"
                className="tap-target -m-1.5 flex size-10 items-center justify-center text-text-tertiary transition-colors [@media(hover:hover)]:hover:text-text-primary"
              >
                <Square className="size-3.5 fill-current" aria-hidden="true" />
              </button>
            }
          />
        }
        footnote={
          <div className="mt-3">
            {stalled ? (
              <div
                role="status"
                className="mb-2 flex min-h-5 items-center gap-1.5 text-xs text-text-tertiary"
              >
                <WifiOff className="size-3.5 shrink-0" aria-hidden="true" />
                <span>{localize('com_ui_deep_research_offline')}</span>
              </div>
            ) : (
              data.action && (
                <div
                  className={cn(
                    'mb-2 line-clamp-2 min-h-5 text-xs text-text-tertiary [overflow-wrap:anywhere]',
                    'thinking-shimmer-active',
                  )}
                >
                  {data.action}
                </div>
              )
            )}
            <div
              role="progressbar"
              aria-label={localize('com_ui_deep_research')}
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-1 w-full overflow-hidden rounded-full bg-surface-hover"
            >
              <div
                className="h-full rounded-full bg-text-accent transition-[width] duration-500 ease-out"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        }
      />
    </div>
  );
}
