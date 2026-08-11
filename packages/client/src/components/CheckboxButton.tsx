import * as React from 'react';
import { useEffect } from 'react';
import { Checkbox, useStoreState, useCheckboxStore } from '@ariakit/react';
import { cn } from '~/utils';

/** Canon §6.3, the tool chip's look minus its size, exported so every chip in
 *  the composer — including ones that are not checkboxes, like the MCP menu
 *  button — draws from the same source instead of hand-copying the recipe.
 *
 *  §6.3 ред. 11.08-4 (владелец, референс Perplexity): пассивный чип — ЗАЛИВКА
 *  (panel), без рамки и тени, под курсором слегка темнеет. */
export const CHIP_BASE =
  'group relative inline-flex items-center justify-center gap-1.5 rounded-full border border-transparent bg-surface-primary-alt text-sm font-medium text-text-secondary transition-all hover:bg-surface-active hover:text-text-primary';

/** The enabled chip is a CARD: card fill + hairline border + t1 — the exact
 *  recipe the sidebar's «Новый чат» wears (the owner named it as the model).
 *  The grey "active" fill of round 3 read backwards — as a disabled state. */
export const CHIP_CHECKED =
  'border-border-light bg-surface-primary text-text-primary hover:bg-surface-hover';

const CheckboxButton: React.ForwardRefExoticComponent<
  {
    icon?: React.ReactNode;
    label: string;
    className?: string;
    checked?: boolean;
    defaultChecked?: boolean;
    isCheckedClassName?: string;
    setValue?: (values: {
      e?: React.ChangeEvent<HTMLInputElement>;
      value: boolean | string;
    }) => void;
  } & React.RefAttributes<HTMLInputElement>
> = React.forwardRef<
  HTMLInputElement,
  {
    icon?: React.ReactNode;
    label: string;
    className?: string;
    checked?: boolean;
    defaultChecked?: boolean;
    isCheckedClassName?: string;
    setValue?: (values: {
      e?: React.ChangeEvent<HTMLInputElement>;
      value: boolean | string;
    }) => void;
  }
>(({ icon, label, setValue, className, checked, defaultChecked, isCheckedClassName }, ref) => {
  const checkbox = useCheckboxStore();
  const isChecked = useStoreState(checkbox, (state) => state?.value);
  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (typeof isChecked !== 'boolean') {
      return;
    }
    setValue?.({ e, value: !isChecked });
  };

  // Sync with controlled checked prop
  useEffect(() => {
    if (checked !== undefined) {
      checkbox.setValue(checked);
    }
  }, [checked, checkbox]);

  // Set initial value from defaultChecked
  useEffect(() => {
    if (defaultChecked !== undefined && checked === undefined) {
      checkbox.setValue(defaultChecked);
    }
  }, [defaultChecked, checked, checkbox]);

  return (
    <Checkbox
      ref={ref}
      store={checkbox}
      onChange={onChange}
      className={cn(
        CHIP_BASE,
        /* Book: the chip is a 34 circle on the phone and a 34 pill on the
           desktop (§6.3), with the §4 tap zone — it sat at 36 with no zone. */
        'tap-target size-[34px] p-2 md:h-[34px] md:w-full md:p-3',

        /* One look for every enabled tool — the raw blue/purple/amber per-tool
           tints this replaced were exactly the kind of colour zoo the canon
           bans. A caller may still override via isCheckedClassName. */
        isChecked && (isCheckedClassName ?? CHIP_CHECKED),

        // Additional custom classes
        className,
      )}
      render={<button type="button" aria-label={label} />}
    >
      {/* Icon colour follows the button, so the checked accent paints it too.
          Small step (16): the book draws 16 inside the 34 chip — call sites
          pass icon-sm icons. */}
      {icon && <span className="icon-sm">{icon as React.JSX.Element}</span>}

      {/* Show the label on larger screens */}
      <span className="hidden truncate md:block">{label}</span>
    </Checkbox>
  );
});

CheckboxButton.displayName = 'CheckboxButton';

export default CheckboxButton;
