import { Progress } from '@librechat/client';
import { Check, Square, Loader2, WifiOff } from 'lucide-react';
import type { TDeepResearchProgress } from '~/store';
import type { TranslationKeys } from '~/hooks';
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
 * The live Deep Research RUNNING card (task #21): the plan steps as a checklist that
 * advances with progress, the current action line, a progress bar, and a Stop button.
 * Driven entirely by the latest `dr_progress` snapshot (proportional — the active step
 * is derived from the coarse progress fraction). This is what replaces the ~6 minutes of
 * silence that read as "hung". Stop reuses the standard generation abort.
 *
 * Review r2: `stalled` (offline park / reconnect backoff) swaps the action line for a
 * "waiting for network" notice and freezes the busy animations — a card with no
 * connection must not pulse as if the run were healthy. Animations also respect
 * prefers-reduced-motion, and the Stop control carries a ≥40px hit area (the visual
 * circle stays small; the tap target does not).
 */
export default function ProgressCard({ data }: { data: TDeepResearchProgress }) {
  const localize = useLocalize();
  const { stopGenerating } = useChatContext();
  const stalled = data.stalled === true;
  const pct = Math.max(0, Math.min(100, Math.round((data.progress ?? 0) * 100)));
  const planSteps = data.steps ?? [];
  const hasPlan = planSteps.length > 0;
  const steps = hasPlan ? planSteps : PHASE_STEPS.map((p) => localize(p.key));
  const activeStep = hasPlan
    ? Math.min(Math.floor((data.progress ?? 0) * planSteps.length), planSteps.length - 1)
    : Math.max(
        0,
        PHASE_STEPS.findIndex((p) => p.phase === data.phase),
      );

  return (
    <div className="my-2 w-full overflow-hidden rounded-2xl border border-border-light bg-surface-primary-alt p-4">
      {steps.length > 0 && (
        <ol className="mb-3 space-y-2.5">
          {steps.map((step, i) => {
            const done = i < activeStep;
            const active = i === activeStep;
            return (
              <li
                key={i}
                aria-current={active ? 'step' : undefined}
                className="flex items-start gap-2.5 text-sm"
              >
                <span
                  className="mt-0.5 flex size-4 shrink-0 items-center justify-center"
                  aria-hidden="true"
                >
                  {done && <Check className="size-4 text-text-primary" />}
                  {active && (
                    <Loader2
                      className={cn(
                        'size-3.5 text-text-secondary',
                        !stalled && 'animate-spin motion-reduce:animate-none',
                      )}
                    />
                  )}
                  {!done && !active && (
                    <span className="size-3 rounded-full border border-border-medium" />
                  )}
                </span>
                <span
                  className={cn(
                    'min-w-0 [overflow-wrap:anywhere]',
                    done || active ? 'text-text-primary' : 'text-text-tertiary',
                  )}
                >
                  {step}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {stalled ? (
        <div
          role="status"
          className="mb-3 flex min-h-5 items-center gap-1.5 text-sm text-text-secondary"
        >
          <WifiOff className="size-3.5 shrink-0" aria-hidden="true" />
          <span>{localize('com_ui_deep_research_offline')}</span>
        </div>
      ) : (
        data.action && (
          <div className="mb-3 line-clamp-2 min-h-5 animate-pulse text-sm text-text-secondary [overflow-wrap:anywhere] motion-reduce:animate-none">
            {data.action}
          </div>
        )
      )}
      <div className="flex items-center gap-3">
        <Progress
          value={pct}
          aria-label={localize('com_ui_deep_research')}
          className="h-1.5 flex-1"
        />
        <button
          type="button"
          onClick={stopGenerating}
          aria-label={localize('com_ui_stop')}
          className="group -m-1.5 flex size-10 shrink-0 items-center justify-center"
        >
          <span className="flex size-7 items-center justify-center rounded-full border border-border-medium text-text-secondary transition-colors group-hover:bg-surface-hover">
            <Square className="size-3 fill-current" />
          </span>
        </button>
      </div>
    </div>
  );
}
