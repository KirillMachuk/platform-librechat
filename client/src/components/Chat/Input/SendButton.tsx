import React, { forwardRef } from 'react';
import { useWatch } from 'react-hook-form';
import { TooltipAnchor } from '@librechat/client';
import type { Control } from 'react-hook-form';
import { ArrowUp } from '~/components/icons';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type SendButtonProps = {
  disabled: boolean;
  control: Control<{ text: string }>;
};

const SubmitButton = React.memo(
  forwardRef((props: { disabled: boolean }, ref: React.ForwardedRef<HTMLButtonElement>) => {
    const localize = useLocalize();
    return (
      <TooltipAnchor
        description={localize('com_nav_send_message')}
        render={
          <button
            ref={ref}
            aria-label={localize('com_nav_send_message')}
            id="send-button"
            disabled={props.disabled}
            className={cn(
              /* Канон §6.13: чернильный круг 36 на десктопе и 38 на телефоне,
                 иконка 20. До этого круг был 36 на обеих ширинах с иконкой 24. */
              'tap-target flex size-[38px] items-center justify-center rounded-full bg-text-primary text-text-primary outline-offset-4 transition-all duration-200 disabled:cursor-not-allowed disabled:text-text-secondary disabled:opacity-45 md:size-9',
            )}
            data-testid="send-button"
            type="submit"
          >
            <span className="" data-state="closed">
              <ArrowUp size={20} aria-hidden="true" />
            </span>
          </button>
        }
      />
    );
  }),
);

const SendButton = React.memo(
  forwardRef((props: SendButtonProps, ref: React.ForwardedRef<HTMLButtonElement>) => {
    const data = useWatch({ control: props.control });
    const content = data?.text?.trim();
    return <SubmitButton ref={ref} disabled={props.disabled || !content} />;
  }),
);

export default SendButton;
