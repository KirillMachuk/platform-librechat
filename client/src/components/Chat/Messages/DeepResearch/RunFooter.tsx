import type { ApprovalPlanStep } from '~/components/Chat/Cards/ApprovalCard';
import type { TDeepResearchProgress } from '~/store/deepResearch';
import { WifiOff } from '~/components/icons';
import { useLocalize } from '~/hooks';

/**
 * The live half of a Deep Research card, shared by the two surfaces that draw
 * a run: the approved plan card (a run WITH a plan) and the standalone
 * running card (a PROCEED run). It was copied between them once and the
 * copies immediately drifted — different step sources, different Stop label
 * (r26 review).
 */

const pct = (progress?: number): number =>
  Math.max(0, Math.min(100, Math.round((progress ?? 0) * 100)));

/** Steps carrying the run's live status: done behind, one being worked on,
 *  the rest ahead. A parked run (offline) has NO active step — a card with no
 *  connection must not look busy. */
export function runStatusSteps(
  titles: string[],
  data: TDeepResearchProgress,
  activeIndex: number,
): ApprovalPlanStep[] {
  return titles.map((title, i) => {
    let status: ApprovalPlanStep['status'] = 'pending';
    if (i < activeIndex) {
      status = 'done';
    } else if (i === activeIndex && data.stalled !== true) {
      status = 'active';
    }
    return { id: String(i), title, status };
  });
}

/** Where a run with N plan steps stands, from the coarse progress fraction. */
export function runActiveIndex(data: TDeepResearchProgress, stepCount: number): number {
  return Math.min(
    Math.floor((data.progress ?? 0) * Math.max(stepCount, 1)),
    Math.max(stepCount - 1, 0),
  );
}

export default function RunFooter({ data }: { data: TDeepResearchProgress }) {
  const localize = useLocalize();
  const value = pct(data.progress);
  return (
    <div className="mt-1">
      {data.stalled === true ? (
        <div
          role="status"
          className="mb-2 flex min-h-5 items-center gap-1.5 text-xs text-text-tertiary"
        >
          <WifiOff className="size-3.5 shrink-0" aria-hidden="true" />
          <span>{localize('com_ui_deep_research_offline')}</span>
        </div>
      ) : (
        data.action && (
          /* The paint-only shimmer: the label utility's inline-block beat
           * `line-clamp-2` by source order and flattened this to one clipped
           * row (package Б review). */
          <div className="thinking-shimmer-paint mb-2 line-clamp-2 min-h-5 text-xs [overflow-wrap:anywhere]">
            {data.action}
          </div>
        )
      )}
      <div
        role="progressbar"
        aria-label={localize('com_ui_deep_research')}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1 w-full overflow-hidden rounded-full bg-surface-hover"
      >
        <div
          className="h-full rounded-full bg-text-accent transition-[width] duration-500 ease-out"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}
