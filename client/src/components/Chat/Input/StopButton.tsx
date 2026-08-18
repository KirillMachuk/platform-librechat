import { memo } from 'react';
import { TooltipAnchor } from '@librechat/client';
import { PlayerStop } from '~/components/icons';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

export default memo(function StopButton({
  stop,
  setShowStopButton,
}: {
  stop: (e: React.MouseEvent<HTMLButtonElement>) => void;
  setShowStopButton: (value: boolean) => void;
}) {
  const localize = useLocalize();

  return (
    <TooltipAnchor
      description={localize('com_nav_stop_generating')}
      render={
        <button
          type="button"
          className={cn(
            'rounded-full bg-text-primary p-1.5 text-text-primary outline-offset-4 transition-all duration-200 disabled:cursor-not-allowed disabled:text-text-secondary disabled:opacity-10',
          )}
          aria-label={localize('com_nav_stop_generating')}
          onClick={(e) => {
            setShowStopButton(false);
            stop(e);
          }}
        >
          {/* ink-label, not surface-primary: the icon must stay the "label on
              ink" color inside .composer-temporary, where surface-primary is
              remapped to a translucent chip fill (same recipe as SendButton). */}
          <PlayerStop className="icon-lg text-ink-label" aria-hidden="true" />
        </button>
      }
    ></TooltipAnchor>
  );
});
