import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { ClassProp } from 'class-variance-authority/types';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '~/utils';

const buttonVariants: (
  props?:
    | ({
        variant?:
          | 'default'
          | 'link'
          | 'submit'
          | 'outline'
          | 'destructive'
          | 'secondary'
          | 'ghost'
          | null
          | undefined;
        size?: 'default' | 'icon' | 'sm' | 'lg' | null | undefined;
      } & ClassProp)
    | undefined,
) => string = cva(
  /**
   * Canon §6.1: radius 12, height 36 (30 sm), padding 16 (12 sm).
   *
   * `tap-target` comes with the height: at 36 a button is under the 44 a finger
   * needs, so the shrink from upstream's 40 is paid for by the invisible
   * extension the canon prescribes for exactly this. It is mobile-only and any
   * explicit position utility still wins over its `relative`.
   */
  /* Вес 400 в базе, а не 500. Канон §1.4: «Вес 400 всюду; 500 — главная
     кнопка», и 500 живёт теперь у заливных вариантов, которые главной кнопкой
     и бывают. Пока `font-medium` стоял здесь, каждая кнопка в продукте — в том
     числе аутлайн и `ghost` — была на ступень жирнее, чем в прототипе. */
  'tap-target inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-45',
  {
    variants: {
      variant: {
        default: 'bg-primary font-medium text-primary-foreground hover:bg-primary/90',
        destructive:
          'bg-surface-destructive font-medium text-destructive-foreground hover:bg-surface-destructive-hover',
        /**
         * The boundary of an outline button is the only thing that says a button
         * is there, so it is the same `control` border a field wears — one token
         * for "edge of an interactive control", fields and buttons alike.
         *
         * It used to be `btn-line` (black at 16%), which lands near 1.3:1 against
         * the card. WCAG 2.2 SC 1.4.11 asks 3:1 of exactly this boundary, and
         * canon §1.6 repeats it; `control` measures 3.4:1. The prototype draws
         * the faint line too — this is a place where the drawing is wrong and the
         * written canon is right, and the owner's own words for it were that the
         * sign-in button "совсем не видна".
         *
         * `btn-line` stays what it is elsewhere: 116 call sites use it for
         * dividers and container edges, which are decoration and carry no such
         * requirement.
         */
        outline:
          'border border-border-control bg-transparent text-text-primary hover:bg-surface-hover',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-surface-hover hover:text-text-primary',
        link: 'text-primary underline-offset-4 hover:underline',
        /** Canon §1.1/§6.1: the main action is ink, never a colour; hover is
         *  opacity .86 rather than a second shade, so `transition-opacity`
         *  deliberately replaces the base `transition-colors` here. */
        submit:
          'bg-ink font-medium text-ink-label transition-opacity duration-90 hover:opacity-[0.86]',
      },
      size: {
        default: 'h-9 px-4',
        /**
         * The canon's small button is 30, and this is not it yet. While the
         * default was upstream's 40, every one of the 46 call sites that asked
         * for `sm` was asking for the normal button, and got 36 — so 36 is what
         * they still get here. Nothing is off canon: 36 is the canon height.
         * Dropping them to 30 is a per-screen judgement (a main action at 30
         * next to a sibling at 36 reads as broken), and those screens arrive
         * with their own batches.
         */
        sm: 'h-9 px-3',
        lg: 'h-11 px-8',
        /** Icon buttons keep radius 8 (§6.2), not the 12 of a text button. The
         *  40 they are drawn at is upstream's and outside what the owner asked
         *  for here; §6.2 wants 32, which is its own sweep across 40 call sites
         *  and their touch targets. */
        icon: 'size-10 rounded-lg',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button: React.ForwardRefExoticComponent<
  ButtonProps & React.RefAttributes<HTMLButtonElement>
> = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type = 'button', ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        type={asChild ? undefined : type}
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
