import { memo, useCallback } from 'react';
import { X } from 'lucide-react';
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from '@headlessui/react';
import type { NavLink } from '~/common';
import { PanelDismissProvider } from './dismiss';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface PanelDialogProps {
  link: NavLink | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function PanelDialog({ link, open, onOpenChange }: PanelDialogProps) {
  const localize = useLocalize();
  const Component = link?.Component;
  const handleClose = useCallback(() => onOpenChange(false), [onOpenChange]);

  return (
    <Transition appear show={open}>
      {/**
       * The panel shares the single modal layer with every other dialog: a dialog opened
       * from inside it (ProjectEditDialog and friends) lands later in the document and is
       * therefore drawn above it, without a per-kind z-index of its own.
       */}
      <Dialog as="div" className="relative z-dialog" onClose={() => onOpenChange(false)}>
        <TransitionChild
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/80" aria-hidden="true" />
        </TransitionChild>

        <TransitionChild
          enter="ease-out duration-200"
          enterFrom="opacity-0 scale-95"
          enterTo="opacity-100 scale-100"
          leave="ease-in duration-100"
          leaveFrom="opacity-100 scale-100"
          leaveTo="opacity-0 scale-95"
        >
          <div className={cn('fixed inset-0 flex w-screen items-center justify-center p-4')}>
            <DialogPanel
              className={cn(
                'flex max-h-[90vh] w-full flex-col overflow-hidden rounded-xl bg-background shadow-2xl backdrop-blur-2xl animate-in sm:rounded-2xl md:w-[760px]',
              )}
            >
              <DialogTitle
                className="flex items-center justify-between border-b border-border-light px-6 py-4 text-left"
                as="div"
              >
                <h2 className="text-lg font-medium leading-6 text-text-primary">
                  {link ? localize(link.title) : ''}
                </h2>
                <button
                  type="button"
                  className="rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-border-xheavy focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-surface-primary dark:focus:ring-offset-surface-primary"
                  onClick={() => onOpenChange(false)}
                  aria-label={localize('com_ui_close')}
                >
                  <X className="icon-md text-text-primary" />
                </button>
              </DialogTitle>
              <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden text-text-primary">
                <PanelDismissProvider onDismiss={handleClose}>
                  {Component ? <Component onClose={handleClose} /> : null}
                </PanelDismissProvider>
              </div>
            </DialogPanel>
          </div>
        </TransitionChild>
      </Dialog>
    </Transition>
  );
}

export default memo(PanelDialog);
