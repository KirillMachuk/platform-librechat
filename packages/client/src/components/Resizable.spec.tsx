import { Group, Panel } from 'react-resizable-panels';
import { render, screen } from '@testing-library/react';
import { ResizableHandleAlt } from './Resizable';

/**
 * Canon §4 and the prototype's `.grip`: the 8px gap between the two cards IS
 * the drag handle. There is no divider strip — the track stays transparent so
 * the canvas shows through, and the only mark is a 3×34 pill in `active` that
 * turns accent and grows to 52 while hovered or dragged.
 *
 * This is asserted on the class string the browser receives, not on the source
 * that produced it: `cn` is `twMerge` and silently drops whichever of two
 * conflicting utilities it decides lost, so `w-2` beating the base `w-px` is a
 * fact about the resolved string and nothing else.
 *
 * It lives in this package rather than in `client` because `client` imports
 * `@librechat/client` as its built bundle — a guard there would be reading
 * whatever `dist` happened to hold.
 */
const separator = (): HTMLElement => {
  render(
    <Group orientation="horizontal">
      <Panel id="left" />
      <ResizableHandleAlt withHandle />
      <Panel id="right" />
    </Group>,
  );
  return screen.getByRole('separator');
};

const classesOf = (element: Element): string[] => element.className.split(/\s+/).filter(Boolean);

describe('the handle between the two cards', () => {
  it('is an 8px gap that paints nothing', () => {
    const c = classesOf(separator());

    expect(c).toContain('w-2');
    expect(c).not.toContain('w-px');
    /* The whole point. A fill here is the divider strip the redesign removed:
       one surface with a line down it instead of two cards side by side. */
    expect(c.filter((name) => name.startsWith('bg-'))).toEqual(['bg-transparent']);
  });

  it('carries the grip pill, visible at rest', () => {
    const c = classesOf(separator().firstElementChild as Element);

    expect(c).toContain('w-[3px]');
    expect(c).toContain('h-[34px]');
    expect(c).toContain('rounded-full');
    expect(c).toContain('bg-surface-active-alt');
    /* The mark it replaced was `invisible` until hover, so the split showed no
       sign there was anything to grab. */
    expect(c).not.toContain('invisible');
    expect(c).toContain('pointer-events-none');
  });

  it('turns accent and grows to 52 on hover and while dragging', () => {
    const c = classesOf(separator().firstElementChild as Element);

    expect(c).toContain('group-hover:h-[52px]');
    expect(c).toContain('group-hover:bg-acc');
    /* `data-separator="active"` is what the library stamps on the element for
       the length of a drag. */
    expect(c).toContain('group-data-[separator=active]:h-[52px]');
    expect(c).toContain('group-data-[separator=active]:bg-acc');
    /* Canon §5: 120ms linear, the same as every other shape change — and by
       the NAMED token. Tailwind treats `duration-[120ms]` as ambiguous and
       silently emits nothing, so the arbitrary form would leave the pill
       snapping between its two sizes with every test still green. */
    expect(c).toContain('duration-120');
    expect(c).not.toContain('duration-[120ms]');
    expect(c).toContain('ease-linear');
  });
});
