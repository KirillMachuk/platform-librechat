import * as React from 'react';
import * as SwitchPrimitives from '@radix-ui/react-switch';
import { cn } from '~/utils';

type BaseSwitchProps = Omit<
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>,
  'aria-label' | 'aria-labelledby'
>;

/**
 * Canon §6.4. Two sizes, and which one you get is not a matter of taste:
 * `default` is the free-standing switch (46×27, knob 23); `row` is the one that
 * lives in a setting row, where the canon shrinks it on a desktop (36×20, knob
 * 16) and leaves it at the touch size on a phone.
 *
 * Travel is track − knob − 2×padding, so it is arithmetic, not a magic number:
 * 46 − 23 − 4 = 19 and 36 − 16 − 4 = 16.
 */
type SwitchSize = 'default' | 'row';

type SwitchOwnProps = { size?: SwitchSize };

type SwitchProps = SwitchOwnProps &
  (
    | (BaseSwitchProps & {
        'aria-label': string;
        'aria-labelledby'?: never;
      })
    | (BaseSwitchProps & {
        'aria-labelledby': string;
        'aria-label'?: never;
      })
  );

const track: Record<SwitchSize, string> = {
  default: 'h-[27px] w-[46px]',
  row: 'h-[27px] w-[46px] md:h-5 md:w-9',
};

const knob: Record<SwitchSize, string> = {
  default: 'size-[23px] data-[state=checked]:translate-x-[19px]',
  row: 'size-[23px] data-[state=checked]:translate-x-[19px] md:size-4 md:data-[state=checked]:translate-x-4',
};

const Switch: React.ForwardRefExoticComponent<
  SwitchProps & React.RefAttributes<HTMLButtonElement>
> = React.forwardRef<React.ElementRef<typeof SwitchPrimitives.Root>, SwitchProps>(
  ({ className, size = 'default', ...props }, ref) => (
    <SwitchPrimitives.Root
      className={cn(
        'peer inline-flex shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors',
        'bg-surface-active data-[state=checked]:bg-acc',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-45',
        track[size],
        className,
      )}
      {...props}
      ref={ref}
    >
      <SwitchPrimitives.Thumb
        className={cn(
          'pointer-events-none block rounded-full shadow-knob ring-0 transition-transform',
          'bg-text-primary data-[state=checked]:bg-acc-ink',
          'data-[state=unchecked]:translate-x-0',
          knob[size],
        )}
      />
    </SwitchPrimitives.Root>
  ),
);
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
export type { SwitchSize };
