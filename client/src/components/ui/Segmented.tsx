import { useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { cn } from '~/utils';

export type SegmentedItem<T extends string> = {
  id: T;
  label: ReactNode;
};

type SegmentedProps<T extends string> = {
  items: SegmentedItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Names the group for a screen reader. */
  label: string;
  /** `id` of the panel each tab controls, when the segment drives panels. */
  panelId?: (id: T) => string;
  className?: string;
};

/**
 * The canon's segmented control (§6.5): a `panel` track with a hairline border
 * and radius 12, tabs on the derived nested radius 12−3=9, and the selected one
 * expressed by tint and colour rather than a grey shade — grey on grey measured
 * 1.09 contrast, which is no distinction at all.
 *
 * Shared rather than copied because the fork now has two of these and the third
 * would have drifted: the model selector's Agents/LLM pair, and the answer
 * switcher a phone shows instead of stacking parallel answers.
 */
export function Segmented<T extends string>({
  items,
  value,
  onChange,
  label,
  panelId,
  className,
}: SegmentedProps<T>) {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  /**
   * Roving tabindex takes the unselected tabs out of the tab order, so arrow
   * keys are the only way to reach them — without these the tab that happens to
   * be selected is the only one a keyboard can ever use.
   */
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    switch (event.key) {
      case 'ArrowRight':
        next = (index + 1) % items.length;
        break;
      case 'ArrowLeft':
        next = (index - 1 + items.length) % items.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = items.length - 1;
        break;
      default:
        /* Everything else — Escape, Tab, typing — belongs to whatever is around us. */
        return;
    }
    event.preventDefault();
    onChange(items[next].id);
    /* Synchronously: switching may remount the panel, and a deferred focus call
       would land on a detached node and drop focus to <body>. */
    tabRefs.current[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      aria-label={label}
      className={cn(
        'flex gap-[3px] rounded-xl border border-border-light bg-surface-primary-alt p-[3px]',
        className,
      )}
    >
      {items.map((item, index) => {
        const isActive = value === item.id;
        return (
          <button
            key={item.id}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            role="tab"
            type="button"
            aria-selected={isActive}
            aria-controls={panelId?.(item.id)}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              'h-11 min-w-0 flex-1 truncate rounded-[9px] px-3 text-[15px] font-medium transition-colors duration-90 md:h-[30px] md:text-[13px]',
              /* Not ring-primary: in the dark theme it resolves to the same grey
                 as surface-active, so the ring on the selected tab was 1:1. */
              'focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text-primary',
              isActive
                ? 'bg-acc-soft text-text-accent'
                : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary',
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export default Segmented;
