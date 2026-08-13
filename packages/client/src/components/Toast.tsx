import { JSX } from 'react/jsx-runtime';
import * as RadixToast from '@radix-ui/react-toast';
import { NotificationSeverity } from '~/common';
import { useToast } from '~/hooks';

export function Toast(): JSX.Element {
  const { toast, onOpenChange } = useToast();
  /* 12.08-2, владелец: «оранжевое окно» тостов — последний реликт LibreChat.
     Канон §6.6: чернильная плашка (как тултипы), обычный вес; серьёзность
     несёт ЦВЕТ ИКОНКИ, а не вся плита. */
  const severityClassName = {
    [NotificationSeverity.INFO]: 'text-[var(--c-ink-label)]/70',
    [NotificationSeverity.SUCCESS]: 'text-green-400',
    [NotificationSeverity.WARNING]: 'text-amber-400',
    [NotificationSeverity.ERROR]: 'text-red-400',
  };

  return (
    <RadixToast.Root
      open={toast.open}
      onOpenChange={onOpenChange}
      className="toast-root"
      style={{
        height: '74px',
        marginBottom: '0px',
      }}
    >
      <div className="w-full p-1 text-center md:w-auto md:text-justify">
        <div
          className={`alert-root pointer-events-auto inline-flex flex-row items-center gap-2 rounded-xl bg-[var(--c-ink)] px-4 py-2.5 text-sm font-normal text-[var(--c-ink-label)] shadow-lg ${''}`}
        >
          {toast.showIcon && (
            <div className={`flex-shrink-0 flex-grow-0 ${severityClassName[toast.severity]}`}>
              <svg
                stroke="currentColor"
                fill="none"
                strokeWidth="2"
                viewBox="0 0 24 24"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="icon-sm"
                height="1em"
                width="1em"
                xmlns="http://www.w3.org/2000/svg"
              >
                <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
          )}
          <RadixToast.Description className="flex-1 justify-center gap-2">
            <div className="whitespace-pre-wrap text-left">{toast.message}</div>
          </RadixToast.Description>
        </div>
      </div>
    </RadixToast.Root>
  );
}
