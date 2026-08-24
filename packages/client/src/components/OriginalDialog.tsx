import * as React from 'react';
import { JSX } from 'react/jsx-runtime';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from '~/components/icons';
import { cn } from '~/utils';

interface OGDialogProps extends DialogPrimitive.DialogProps {
  triggerRef?: React.RefObject<HTMLButtonElement | HTMLInputElement | HTMLDivElement | null>;
  triggerRefs?: React.RefObject<HTMLButtonElement | HTMLInputElement | HTMLDivElement | null>[];
}

const Dialog: React.ForwardRefExoticComponent<OGDialogProps & React.RefAttributes<HTMLDivElement>> =
  React.forwardRef<HTMLDivElement, OGDialogProps>(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ({ children, triggerRef, triggerRefs, onOpenChange, ...props }, ref) => {
      const handleOpenChange = (open: boolean) => {
        if (!open && triggerRef?.current) {
          setTimeout(() => {
            triggerRef.current?.focus();
          }, 0);
        }
        if (triggerRefs?.length) {
          triggerRefs.forEach((ref) => {
            if (ref?.current) {
              setTimeout(() => {
                ref.current?.focus();
              }, 0);
            }
          });
        }
        onOpenChange?.(open);
      };

      return (
        <DialogPrimitive.Root {...props} onOpenChange={handleOpenChange}>
          {children}
        </DialogPrimitive.Root>
      );
    },
  );

const DialogTrigger: React.ForwardRefExoticComponent<
  DialogPrimitive.DialogTriggerProps & React.RefAttributes<HTMLButtonElement>
> = DialogPrimitive.Trigger;

const DialogPortal: React.FC<DialogPrimitive.DialogPortalProps> = DialogPrimitive.Portal;

const DialogClose: React.ForwardRefExoticComponent<
  DialogPrimitive.DialogCloseProps & React.RefAttributes<HTMLButtonElement>
> = DialogPrimitive.Close;

export const DialogOverlay: React.ForwardRefExoticComponent<
  Omit<DialogPrimitive.DialogOverlayProps & React.RefAttributes<HTMLDivElement>, 'ref'> &
    React.RefAttributes<HTMLDivElement>
> = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, style, ...props }, ref) => (
  /* Вуаль живёт на общем слое окон и стоит прямо перед своим содержимым, поэтому
     она под ним и одновременно поверх окна, из которого это окно открыли. */
  <DialogPrimitive.Overlay
    ref={ref}
    style={style}
    className={cn(
      'fixed inset-0 z-dialog bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

type DialogContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
  disableScroll?: boolean;
  overlayClassName?: string;
};

/** Base dress of every OGDialogContent. The `max-w-[calc(100vw-2rem)]` phone
 * cap is load-bearing: its predecessor `max-w-11/12` was a class Tailwind
 * never generates (no fractions in the maxWidth scale), so dialogs without
 * their own width rendered edge-to-edge on phones (round 23, item 4). */
export const dialogContentBaseClassName =
  'fixed left-[50%] top-[50%] z-dialog grid max-h-[90vh] w-full max-w-[calc(100vw-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 overflow-y-auto overflow-x-hidden rounded-2xl bg-surface-dialog p-6 text-text-primary shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]';

const DialogContent: React.ForwardRefExoticComponent<
  Omit<DialogPrimitive.DialogContentProps & React.RefAttributes<HTMLDivElement>, 'ref'> & {
    showCloseButton?: boolean;
    disableScroll?: boolean;
    overlayClassName?: string;
  } & React.RefAttributes<HTMLDivElement>
> = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Content>, DialogContentProps>(
  (
    {
      className,
      overlayClassName,
      showCloseButton = true,
      children,
      style,
      onEscapeKeyDown: propsOnEscapeKeyDown,
      /* Swallowed on purpose, never spread onto the DOM: several call sites
         pass `title` as if it were a heading prop, Radix forwards unknown
         props onto its Content <div>, and a `title` ATTRIBUTE there draws the
         OS balloon over the whole dialog — banned by the tooltip canon
         (DESIGN_SYSTEM §6.6). Dialog headings are DialogTitle elements. */
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      title: _title,
      ...props
    },
    ref,
  ) => {
    /* Handle Escape key to prevent closing dialog if a tooltip or dropdown has focus
    (this is a workaround in order to achieve WCAG compliance which requires
    that our tooltips be dismissable with Escape key) */
    const handleEscapeKeyDown = React.useCallback(
      (event: KeyboardEvent) => {
        const activeElement = document.activeElement;

        // Check if active element is a trigger with an open popover (aria-expanded="true")
        if (activeElement?.getAttribute('aria-expanded') === 'true') {
          event.preventDefault();
          return;
        }

        // Check if a dropdown menu, listbox, or combobox has focus (focus is within it)
        const popoverElements = document.querySelectorAll(
          '[role="menu"], [role="listbox"], [role="combobox"]',
        );
        for (const popover of popoverElements) {
          if (popover.contains(activeElement)) {
            event.preventDefault();
            return;
          }
        }

        // Check if a tooltip has focus (focus is within it)
        const tooltips = document.querySelectorAll('.tooltip');
        for (const tooltip of tooltips) {
          if (tooltip.contains(activeElement)) {
            event.preventDefault();
            return;
          }
        }

        propsOnEscapeKeyDown?.(event);
      },
      [propsOnEscapeKeyDown],
    );

    return (
      <DialogPortal>
        <DialogOverlay className={overlayClassName} />
        <DialogPrimitive.Content
          ref={ref}
          style={style}
          onEscapeKeyDown={handleEscapeKeyDown}
          className={cn(dialogContentBaseClassName, className)}
          {...props}
        >
          {children}
          {showCloseButton && (
            <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-ring-primary ring-offset-background transition-opacity hover:opacity-100 focus:outline-none disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
              <X className="h-6 w-6" aria-hidden="true" />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    );
  },
);
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader: {
  ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): JSX.Element;
  displayName: string;
} = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): JSX.Element => (
  <div className={cn('flex flex-col space-y-1.5 text-center sm:text-left', className)} {...props} />
);
DialogHeader.displayName = 'DialogHeader';

const DialogFooter: {
  ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): JSX.Element;
  displayName: string;
} = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): JSX.Element => (
  <div
    className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)}
    {...props}
  />
);
DialogFooter.displayName = 'DialogFooter';

const DialogTitle: React.ForwardRefExoticComponent<
  Omit<DialogPrimitive.DialogTitleProps & React.RefAttributes<HTMLHeadingElement>, 'ref'> &
    React.RefAttributes<HTMLHeadingElement>
> = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-lg font-semibold leading-none tracking-tight', className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription: React.ForwardRefExoticComponent<
  Omit<DialogPrimitive.DialogDescriptionProps & React.RefAttributes<HTMLParagraphElement>, 'ref'> &
    React.RefAttributes<HTMLParagraphElement>
> = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-text-secondary', className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog as OGDialog,
  DialogPortal as OGDialogPortal,
  DialogOverlay as OGDialogOverlay,
  DialogClose as OGDialogClose,
  DialogTrigger as OGDialogTrigger,
  DialogContent as OGDialogContent,
  DialogHeader as OGDialogHeader,
  DialogFooter as OGDialogFooter,
  DialogTitle as OGDialogTitle,
  DialogDescription as OGDialogDescription,
};
