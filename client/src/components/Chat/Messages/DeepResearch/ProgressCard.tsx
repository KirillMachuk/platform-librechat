import type { TDeepResearchProgress } from '~/store';
import { ApprovalCard, ApprovalCardHeaderAction } from '~/components/Chat/Cards/ApprovalCard';
import useCardStrings from '~/components/Chat/Cards/useCardStrings';
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

  const cardStrings = useCardStrings();

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
