import React from 'react';
import { cn } from '~/utils';

interface ConvoLinkProps {
  isActiveConvo: boolean;
  isPopoverActive: boolean;
  title: string | null;
  onRename: () => void;
  isSmallScreen: boolean;
  localize: (key: any, options?: any) => string;
  children?: React.ReactNode;
}

const ConvoLink: React.FC<ConvoLinkProps> = ({
  isActiveConvo,
  isPopoverActive,
  title,
  onRename,
  isSmallScreen,
  localize,
  children,
}) => {
  return (
    <div
      className={cn(
        'flex min-w-0 grow items-center gap-2 overflow-hidden rounded-xl px-2.5',
        isActiveConvo || isPopoverActive ? 'bg-surface-active' : '',
      )}
      title={title ?? undefined}
      aria-current={isActiveConvo ? 'page' : undefined}
      style={{ width: '100%' }}
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
      {/* Отметка открытого чата — точка `acc` справа (прототип, экран 8).
          Стоит после градиента, иначе он бы её закрасил. */}
      {isActiveConvo && (
        <span
          className="relative ml-auto h-[7px] w-[7px] flex-none rounded-full bg-text-accent"
          aria-hidden="true"
        />
      )}
    </div>
  );
};

export default ConvoLink;
