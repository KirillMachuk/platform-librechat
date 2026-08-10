/* eslint-disable */
import * as React from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import { cn } from '~/utils';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea: React.ForwardRefExoticComponent<
  TextareaProps & React.RefAttributes<HTMLTextAreaElement>
> = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className = '', ...props }, ref) => {
  return (
    <textarea
      className={cn(
        'flex h-20 w-full resize-none rounded-md border border-gray-300 bg-transparent px-3 py-2 text-sm placeholder:text-gray-400 focus:border-border-focus focus:outline-none focus:ring-[3px] focus:ring-ring-primary-soft disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-50',
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = 'Textarea';

export { Textarea };
