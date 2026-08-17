import React from 'react';
import { TooltipAnchor } from '@librechat/client';
import { cn } from '~/utils';

interface ConvoLinkProps {
  isActiveConvo: boolean;
  /** Something arrived here while the person was somewhere else. */
  isUnread?: boolean;
  isPopoverActive: boolean;
  title: string | null;
  onRename: () => void;
  isSmallScreen: boolean;
  localize: (key: any, options?: any) => string;
  children?: React.ReactNode;
}

const ConvoLink: React.FC<ConvoLinkProps> = ({
  isActiveConvo,
  isUnread = false,
  isPopoverActive,
  title,
  onRename,
  isSmallScreen,
  localize,
  children,
}) => {
  return (
    /* The narrow sidebar clips most titles, so the row keeps its full-text
       hint — but as the canon ink plate (§6.6), not the OS balloon the native
       `title` attribute drew (owner 17.08: one tooltip design everywhere). */
    <TooltipAnchor
      description={title || localize('com_ui_untitled')}
      render={
        <div
          className={cn(
            'flex min-w-0 grow items-center gap-2 overflow-hidden rounded-xl px-2.5',
            isActiveConvo || isPopoverActive ? 'bg-surface-active' : '',
          )}
          aria-current={isActiveConvo ? 'page' : undefined}
          style={{ width: '100%' }}
        />
      }
    >
      {children}
      <div
        className="relative flex-1 grow overflow-hidden whitespace-nowrap"
        style={{ textOverflow: 'clip' }}
        onDoubleClick={(e) => {
          if (isSmallScreen) {
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          onRename();
        }}
        aria-label={title || localize('com_ui_untitled')}
      >
        {title || localize('com_ui_untitled')}
      </div>
      <div
        className={cn(
          'pointer-events-none absolute bottom-0.5 right-0.5 top-0.5 w-20 rounded-r-md bg-gradient-to-l',
          isActiveConvo || isPopoverActive
            ? 'from-surface-active'
            : 'from-surface-primary-alt from-0% to-transparent group-hover:from-surface-hover group-hover:from-40%',
        )}
        aria-hidden="true"
      />
      {/* The dot means "there is something here you have not seen" — the filled
          row already says which chat is open, and one state does not need two
          marks. It sits after the gradient, which would otherwise paint over
          it. Named for a screen reader: a colour alone says nothing aloud. */}
      {isUnread && (
        <span
          className="relative ml-auto h-[7px] w-[7px] flex-none rounded-full bg-acc"
          role="status"
          aria-label={localize('com_ui_unread')}
        />
      )}
    </TooltipAnchor>
  );
};

export default ConvoLink;
