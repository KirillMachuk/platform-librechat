import { memo, useCallback, useContext, useState, createContext } from 'react';
import { createPortal } from 'react-dom';
import { Dialog, DialogPanel, DialogTitle, Transition, TransitionChild } from '@headlessui/react';
import type { NavLink } from '~/common';
import { PanelDismissProvider } from './dismiss';
import { X } from '~/components/icons';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const HeaderSlot = createContext<HTMLElement | null>(null);

/**
 * Puts a section's main action beside the panel's title instead of on a row of
 * its own underneath it.
 *
 * The prototype draws every section that way (screens 11–17), and a row that
 * holds one button costs 52px of a panel that is already scrolling. The panel
 * cannot know what that action is — each section renders its own into here.
 */
export function PanelHeaderAction({ children }: { children: React.ReactNode }) {
  const slot = useContext(HeaderSlot);
  return slot ? createPortal(children, slot) : null;
}

interface PanelDialogProps {
  link: NavLink | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function PanelDialog({ link, open, onOpenChange }: PanelDialogProps) {
  const localize = useLocalize();
  const Component = link?.Component;
  const handleClose = useCallback(() => onOpenChange(false), [onOpenChange]);
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);

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
            {/* Canon §4: dialogs are 420 / 560 / 720. */}
            <DialogPanel
              className={cn(
                'flex max-h-[90vh] w-full flex-col overflow-hidden rounded-xl bg-background shadow-lg backdrop-blur-2xl animate-in sm:rounded-2xl md:w-[720px]',
              )}
            >
              <DialogTitle
                className="flex items-center justify-between gap-3 border-b border-border-light px-6 py-4 text-left"
                as="div"
              >
                <h2 className="min-w-0 truncate text-lg font-medium leading-6 text-text-primary">
                  {link ? localize(link.title) : ''}
                </h2>
                <div className="flex flex-shrink-0 items-center gap-3">
                  <div ref={setHeaderSlot} className="flex items-center gap-2" />
                  <button
                    type="button"
                    className="rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-border-xheavy focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-surface-primary dark:focus:ring-offset-surface-primary"
                    onClick={() => onOpenChange(false)}
                    aria-label={localize('com_ui_close')}
                  >
                    <X className="icon-md text-text-primary" />
                  </button>
                </div>
              </DialogTitle>
              <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden text-text-primary">
                <HeaderSlot.Provider value={headerSlot}>
                  <PanelDismissProvider onDismiss={handleClose}>
                    {Component ? <Component onClose={handleClose} /> : null}
                  </PanelDismissProvider>
                </HeaderSlot.Provider>
              </div>
            </DialogPanel>
          </div>
        </TransitionChild>
      </Dialog>
    </Transition>
  );
}

export default memo(PanelDialog);
