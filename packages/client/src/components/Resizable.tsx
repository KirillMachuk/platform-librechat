import { JSX } from 'react/jsx-runtime';
import { GripVertical } from 'lucide-react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import type { ComponentProps } from 'react';
import { cn } from '~/utils';

const ResizablePanelGroup = ({
  className = '',
  ...props
}: ComponentProps<typeof Group>): JSX.Element => (
  <Group className={cn('h-full w-full', className)} {...props} />
);

const ResizablePanel: typeof Panel = Panel;

const ResizableHandle = ({
  withHandle,
  className = '',
  ...props
}: ComponentProps<typeof Separator> & {
  withHandle?: boolean;
}): JSX.Element => (
  <Separator
    className={cn(
      'relative flex w-px items-center justify-center bg-border after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1',
      className,
    )}
    {...props}
  >
    {withHandle && (
      <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border bg-border">
        <GripVertical className="h-2.5 w-2.5" />
      </div>
    )}
  </Separator>
);

/**
 * The handle between two cards, per canon §4 and the prototype's `.grip`.
 *
 * The gap IS the handle: 8px of bare canvas, no divider strip, with a 3×34 pill
 * in `active` that turns accent and grows to 52 while hovered or dragged. The
 * prototype widens the grab zone with a pseudo-element because it is hand-rolled
 * HTML; here the library already guarantees a 10px (mouse) / 20px (touch)
 * resize target, so repeating that would only fight it.
 *
 * The transition uses the NAMED `duration-120`: Tailwind reads the arbitrary
 * `duration-[120ms]` as ambiguous and silently emits no rule at all, which is
 * why the fork spells the two canon durations out in its config.
 */
const ResizableHandleAlt = ({
  withHandle,
  className = '',
  ...props
}: ComponentProps<typeof Separator> & {
  withHandle?: boolean;
}): JSX.Element => (
  <Separator
    className={cn(
      'group relative flex w-2 items-center justify-center bg-transparent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1',
      className,
    )}
    {...props}
  >
    {withHandle && (
      <div className="pointer-events-none h-[34px] w-[3px] rounded-full bg-surface-active-alt transition-[background-color,height] duration-120 ease-linear group-hover:h-[52px] group-hover:bg-acc group-data-[separator=active]:h-[52px] group-data-[separator=active]:bg-acc" />
    )}
  </Separator>
);

export { ResizablePanelGroup, ResizablePanel, ResizableHandle, ResizableHandleAlt };
