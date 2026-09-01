import { RecoilRoot } from 'recoil';
import { render, screen } from '@testing-library/react';
import { chatColumnClass } from '~/utils';
import CommandRow from '../CommandRow';

/**
 * The switcher row of a hidden Deep Research command has no body to align itself
 * against, so its box is the whole of it. Both render paths used to spell the column
 * out by hand — `md:max-w-[47rem] xl:max-w-[55rem]`, the numbers from before
 * `chatColumnClass` became the one source — and the row landed 40px LEFT of the thread
 * (measured on the mock stand at 1280: column 364…1164, row 324…1204). A look nobody
 * guards gets reverted silently, so the contract is asserted on the RESOLVED classes:
 * the row asks the shared helper for the column, and the inner row spans it.
 */
function renderRow(siblingCount = 2) {
  return render(
    <RecoilRoot>
      <CommandRow siblingIdx={1} siblingCount={siblingCount} setSiblingIdx={jest.fn()} />
    </RecoilRoot>,
  );
}

describe('DR command row', () => {
  it('renders nothing without siblings — the row is hidden, switcher and all', () => {
    const { container } = renderRow(1);
    expect(container).toBeEmptyDOMElement();
  });

  it('FAILS ON PRE-FIX CODE: takes its width from the shared column helper (r29)', () => {
    renderRow();
    const row = screen.getByLabelText(/answer variants/i).closest('div.mx-auto');
    expect(row).not.toBeNull();
    for (const token of chatColumnClass(false).split(' ')) {
      expect(row).toHaveClass(token);
    }
    expect(row?.className).not.toMatch(/47rem|55rem/);
  });

  it('FAILS ON PRE-FIX CODE: the inner row spans the column, so justify-end can reach it', () => {
    renderRow();
    const subRow = screen.getByLabelText(/answer variants/i).parentElement;
    /* `cn` is twMerge: the SubRow default `justify-start` is REPLACED, not appended,
     * so the resolved class is what the browser sees. */
    expect(subRow).toHaveClass('w-full', 'justify-end');
    expect(subRow).not.toHaveClass('justify-start');
  });
});
