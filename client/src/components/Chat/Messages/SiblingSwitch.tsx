import { TooltipAnchor } from '@librechat/client';
import type { TMessageProps } from '~/common';
import { ChevronLeft, ChevronRight } from '~/components/icons';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type TSiblingSwitchProps = Pick<TMessageProps, 'siblingIdx' | 'siblingCount' | 'setSiblingIdx'>;

export default function SiblingSwitch({
  siblingIdx,
  siblingCount,
  setSiblingIdx,
}: TSiblingSwitchProps) {
  const localize = useLocalize();
  if (siblingIdx === undefined) {
    return null;
  } else if (siblingCount === undefined) {
    return null;
  }

  const previous = () => {
    setSiblingIdx && setSiblingIdx(siblingIdx - 1);
  };

  const next = () => {
    setSiblingIdx && setSiblingIdx(siblingIdx + 1);
  };

  const buttonStyle = cn(
    'hover-button tap-target flex h-7 w-7 items-center justify-center rounded-lg text-text-secondary-alt [&_svg]:h-4 [&_svg]:w-4',
    'hover:text-text-primary hover:bg-surface-hover',
    'group-hover:visible group-focus-within:visible group-[.final-completion]:visible',
    'focus-visible:outline-none',
  );

  return siblingCount > 1 ? (
    <nav
      className="visible flex items-center justify-center gap-2 self-center pt-0 text-xs"
      aria-label={localize('com_ui_answer_variants')}
    >
      <TooltipAnchor
        description={localize('com_ui_answer_variant_prev')}
        render={
          <button
            className={buttonStyle}
            type="button"
            onClick={previous}
            disabled={siblingIdx == 0}
            aria-label={localize('com_ui_answer_variant_prev')}
            aria-disabled={siblingIdx == 0}
          >
            <ChevronLeft size="19" aria-hidden="true" />
          </button>
        }
      />
      <span
        className="flex-shrink-0 flex-grow tabular-nums"
        aria-live="polite"
        aria-atomic="true"
        role="status"
      >
        {siblingIdx + 1} / {siblingCount}
      </span>
      <TooltipAnchor
        description={localize('com_ui_answer_variant_next')}
        render={
          <button
            className={buttonStyle}
            type="button"
            onClick={next}
            disabled={siblingIdx == siblingCount - 1}
            aria-label={localize('com_ui_answer_variant_next')}
            aria-disabled={siblingIdx == siblingCount - 1}
          >
            <ChevronRight size="19" aria-hidden="true" />
          </button>
        }
      />
    </nav>
  ) : null;
}
