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
  'w-full rounded-xl border bg-surface-primary px-3 text-base text-text-primary placeholder:text-text-tertiary focus-visible:outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-45 h-12 md:h-9 md:text-sm';

/*
 * Two things were wrong with the breakpoint and the size above, and both were
 * ours. Canon §7 knows exactly two breakpoints, 768 and 1024 — `sm:` is 640, so
 * between 640 and 768 a field was already desktop-sized while the layout around
 * it was still the phone's. And the phone size was 15px: Safari zooms the page
 * on focus below 16, which canon §7 calls out by name.
 */

/**
 * The normal, non-error resting look and focus colours that go with FIELD_BASE.
 *
 * Resting = hairline + the sm shadow, the composer's dress (owner 11.08 round 3:
 * the 3:1 `control` line read as a harsh black stroke on every field). The
 * boundary is carried by fill + shadow + label, the way GPT/Kimi/Perplexity
 * draw fields; the ≥3:1 line now lives only in the FOCUS state — the darkening
 * to `t1` (§1.8) stays, so a keyboard user still gets a compliant indicator.
 */
export const FIELD_BORDER =
  'border-border-light shadow-sm focus-visible:border-border-focus focus-visible:ring-ring-primary-soft';

const Input: React.ForwardRefExoticComponent<InputProps & React.RefAttributes<HTMLInputElement>> =
  React.forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => {
    return (
      <input
        className={cn(
          // Канон §6.4 (ред. 11.08-3): покой — волосяная линия, как у всех
          // полей платформы; тени здесь НЕТ нарочно — этот ввод часто живёт
          // внутри чужой рамки (см. FIELD_BASE), и тень торчала бы из-под
          // неё в четырнадцати местах. Фокус — потемнение рамки до чернил
          // (§1.8), это и есть индикатор ≥3:1.
          // Раньше здесь стоял голый `focus-visible:outline-none`, который
          // гасил и общий контур: ни одно из 36 полей не показывало фокус.
          'flex h-10 w-full rounded-xl border border-border-light bg-transparent px-3 py-2 text-sm ring-offset-background placeholder:text-text-tertiary focus-visible:border-border-focus focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring-primary-soft disabled:cursor-not-allowed disabled:opacity-50',
          className ?? '',
        )}
        ref={ref}
        {...props}
      />
    );
  });

Input.displayName = 'Input';

export { Input };
