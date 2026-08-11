import * as React from 'react';
import { useEffect } from 'react';
import { Checkbox, useStoreState, useCheckboxStore } from '@ariakit/react';
import { cn } from '~/utils';

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
        // Base styling from MultiSelect's selectClassName
        'group relative inline-flex items-center justify-center gap-1.5',
        'rounded-full border border-border-medium text-sm font-medium',
        'size-9 p-2 transition-all md:w-full md:p-3',
        'bg-transparent shadow-sm hover:bg-surface-hover',

        /* An enabled tool chip is a switch in chip form, and the book draws it
           the way every switch is drawn: the accent's soft fill with the accent
           ink, no border. One look for every tool — the raw blue/purple/amber
           per-tool tints this replaces were exactly the kind of colour zoo the
           canon bans. A caller may still override via isCheckedClassName. */
        isChecked &&
          (isCheckedClassName ??
            'border-transparent bg-acc-soft text-text-accent hover:bg-acc-soft'),

        // Additional custom classes
        className,
      )}
      render={<button type="button" aria-label={label} />}
    >
      {/* Icon colour follows the button, so the checked accent paints it too. */}
      {icon && <span className="icon-md">{icon as React.JSX.Element}</span>}

      {/* Show the label on larger screens */}
      <span className="hidden truncate md:block">{label}</span>
    </Checkbox>
  );
});

CheckboxButton.displayName = 'CheckboxButton';

export default CheckboxButton;
