import * as React from 'react';
import { cn } from '~/utils';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

/**
 * Canon §6.4, everything about a field except which border it wears: 36 high on
 * a desktop and 48 on a phone, radius 12, `card` fill, placeholder t3, focus a
 * 3px `acc-soft` ring and never an outline.
 *
 * This is the *field*, and it is deliberately not what `Input` renders. Fourteen
 * places in this codebase nest `Input` inside chrome they drew themselves — the
 * prompt's description and command rows, the parameter sliders, the key dialog —
 * and neutralise its border to do it. Giving `Input` the field's height and fill
 * puts a 48px opaque box inside their 40px row: measured on the prompts screen,
 * where it covered the floating label and the character counter.
 *
 * So a form that wants a canon field asks for one by name. The sign-in screens
 * already do; they used to carry their own copy of these numbers.
 */
export const FIELD_BASE =
  'w-full rounded-xl border bg-surface-primary px-3 text-[15px] text-text-primary placeholder:text-text-tertiary focus-visible:outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-45 h-12 sm:h-9 sm:text-sm';

/** The normal, non-error border and focus colours that go with FIELD_BASE. */
export const FIELD_BORDER =
  'border-border-control focus-visible:border-border-focus focus-visible:ring-ring-primary-soft';

const Input: React.ForwardRefExoticComponent<InputProps & React.RefAttributes<HTMLInputElement>> =
  React.forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => {
    return (
      <input
        className={cn(
          // Канон §6.4: рамка `control` (обязана держать 3:1 — `border-light`
          // давала 1,26:1), фокус — рамка `acc` плюс кольцо 3px `acc-soft`.
          // Раньше здесь стоял голый `focus-visible:outline-none`, который
          // гасил и общий контур: ни одно из 36 полей не показывало фокус.
          // Радиус 12 — по §4; высота и заливка остаются как есть, потому что
          // этот ввод часто живёт внутри чужой рамки (см. FIELD_BASE).
          'flex h-10 w-full rounded-xl border border-border-control bg-transparent px-3 py-2 text-sm ring-offset-background placeholder:text-text-tertiary focus-visible:border-border-focus focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring-primary-soft disabled:cursor-not-allowed disabled:opacity-50',
          className ?? '',
        )}
        ref={ref}
        {...props}
      />
    );
  });

Input.displayName = 'Input';

export { Input };
