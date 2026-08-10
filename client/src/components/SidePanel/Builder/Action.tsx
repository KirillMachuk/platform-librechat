import { useState } from 'react';
import { GearIcon } from '@librechat/client';
import type { Action } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

export default function Action({ action, onClick }: { action: Action; onClick: () => void }) {
  const localize = useLocalize();
  const [isHovering, setIsHovering] = useState(false);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          onClick();
        }
      }}
      className="group flex w-full rounded-lg border border-border-medium text-sm hover:cursor-pointer focus:outline-none"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      aria-label={`Action for ${action.metadata.domain}`}
    >
      <div
        className="h-9 grow overflow-hidden text-ellipsis whitespace-nowrap px-3 py-2"
        style={{ wordBreak: 'break-all' }}
      >
        {action.metadata.domain}
      </div>
      <div
        className={cn(
          'h-9 w-9 min-w-9 items-center justify-center rounded-lg transition-colors duration-200 hover:bg-surface-tertiary focus:outline-none group-focus:flex',
          isHovering ? 'flex' : 'hidden',
        )}
        aria-label={localize('com_ui_action_settings')}
      >
        <GearIcon className="icon-sm" aria-hidden="true" />
      </div>
    </div>
  );
}
