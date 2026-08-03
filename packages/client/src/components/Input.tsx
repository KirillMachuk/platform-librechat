import * as React from 'react';
import { cn } from '~/utils';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input: React.ForwardRefExoticComponent<InputProps & React.RefAttributes<HTMLInputElement>> =
  React.forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => {
    return (
      <input
        className={cn(
          // Канон §6.4: рамка `control` (обязана держать 3:1 — `border-light`
          // давала 1,26:1), фокус — рамка `acc` плюс кольцо 3px `acc-soft`.
          // Раньше здесь стоял голый `focus-visible:outline-none`, который
          // гасил и общий контур: ни одно из 36 полей не показывало фокус.
          'flex h-10 w-full rounded-lg border border-border-control bg-transparent px-3 py-2 text-sm ring-offset-background placeholder:text-text-tertiary focus-visible:border-border-focus focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring-primary-soft disabled:cursor-not-allowed disabled:opacity-50',
          className ?? '',
        )}
        ref={ref}
        {...props}
      />
    );
  });

Input.displayName = 'Input';

export { Input };
