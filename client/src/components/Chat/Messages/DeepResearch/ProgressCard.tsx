import { Progress } from '@librechat/client';
import { Check, Square, Loader2 } from 'lucide-react';
import type { TDeepResearchProgress } from '~/store';
import { useChatContext } from '~/Providers';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/**
 * The live Deep Research RUNNING card (task #21): the plan steps as a checklist that
 * advances with progress, the current action line, a progress bar, and a Stop button.
 * Driven entirely by the latest `dr_progress` snapshot (proportional — the active step
 * is derived from the coarse progress fraction). This is what replaces the ~6 minutes of
 * silence that read as "hung". Stop reuses the standard generation abort.
 */
export default function ProgressCard({ data }: { data: TDeepResearchProgress }) {
  const localize = useLocalize();
  const { stopGenerating } = useChatContext();
  const steps = data.steps ?? [];
  const pct = Math.max(0, Math.min(100, Math.round((data.progress ?? 0) * 100)));
  const activeStep = steps.length
    ? Math.min(Math.floor((data.progress ?? 0) * steps.length), steps.length - 1)
    : -1;

  return (
    <div className="my-2 w-full rounded-2xl border border-border-light bg-surface-primary-alt p-4">
      {steps.length > 0 && (
        <ol className="mb-3 space-y-2.5">
          {steps.map((step, i) => {
            const done = i < activeStep;
            const active = i === activeStep;
            return (
              <li key={i} className="flex items-start gap-2.5 text-sm">
                <span
                  className="mt-0.5 flex size-4 shrink-0 items-center justify-center"
                  aria-hidden="true"
                >
                  {done && <Check className="size-4 text-text-primary" />}
                  {active && <Loader2 className="size-3.5 animate-spin text-text-secondary" />}
                  {!done && !active && (
                    <span className="size-3 rounded-full border border-border-medium" />
                  )}
                </span>
                <span className={cn(done || active ? 'text-text-primary' : 'text-text-tertiary')}>
                  {step}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {data.action && (
        <div className="mb-3 animate-pulse text-sm text-text-secondary">{data.action}</div>
      )}
      <div className="flex items-center gap-3">
        <Progress value={pct} className="h-1.5 flex-1" />
        <button
          type="button"
          onClick={stopGenerating}
          aria-label={localize('com_ui_stop')}
          className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border-medium text-text-secondary transition-colors hover:bg-surface-hover"
        >
          <Square className="size-3 fill-current" />
        </button>
      </div>
    </div>
  );
}
