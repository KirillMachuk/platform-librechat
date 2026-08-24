import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { TooltipAnchor } from '../Tooltip';

/* Owner р22-4: full-text plates over truncatable labels show ONLY when the
 * label is actually cut. Measured at hover time — renames and resizes are
 * honored. Anchors without the flag (icon/action tooltips) are untouched. */

const defineWidths = (el: HTMLElement, scrollWidth: number, clientWidth: number) => {
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth });
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth });
};

const hoverAnchor = (anchor: HTMLElement) => {
  act(() => {
    fireEvent.mouseMove(document.body, { screenX: 4, screenY: 4 });
    fireEvent.mouseMove(document.body, { screenX: 11, screenY: 13 });
  });
  act(() => {
    fireEvent.mouseEnter(anchor);
    fireEvent.mouseMove(anchor, { screenX: 15, screenY: 15 });
  });
  act(() => {
    jest.advanceTimersByTime(400);
  });
};

describe('TooltipAnchor onlyWhenTruncated', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows the plate when the label is cut', () => {
    render(
      <TooltipAnchor
        description="Отчёт_по_продажам_за_август_2026_года.docx"
        onlyWhenTruncated
        render={
          <div data-testid="anchor" className="truncate">
            Отчёт…
          </div>
        }
      />,
    );
    const anchor = screen.getByTestId('anchor');
    defineWidths(anchor.querySelector('.truncate') ?? anchor, 400, 200);
    hoverAnchor(anchor);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('stays silent when the label fully fits', () => {
    render(
      <TooltipAnchor
        description="акт.docx"
        onlyWhenTruncated
        render={
          <div data-testid="anchor" className="truncate">
            акт.docx
          </div>
        }
      />,
    );
    const anchor = screen.getByTestId('anchor');
    defineWidths(anchor.querySelector('.truncate') ?? anchor, 180, 200);
    hoverAnchor(anchor);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('re-measures on every hover — a rename can flip the verdict', () => {
    render(
      <TooltipAnchor
        description="имя"
        onlyWhenTruncated
        render={
          <div data-testid="anchor" className="truncate">
            имя
          </div>
        }
      />,
    );
    const anchor = screen.getByTestId('anchor');
    const label = (anchor.querySelector('.truncate') ?? anchor) as HTMLElement;
    defineWidths(label, 100, 200);
    hoverAnchor(anchor);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    act(() => {
      fireEvent.mouseLeave(anchor);
      jest.advanceTimersByTime(100);
    });
    defineWidths(label, 400, 200);
    hoverAnchor(anchor);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('an anchor WITHOUT the flag keeps its plate for a fitting label', () => {
    render(
      <TooltipAnchor
        description="Добавить закладку"
        render={<div data-testid="anchor">икон</div>}
      />,
    );
    const anchor = screen.getByTestId('anchor');
    defineWidths(anchor, 100, 200);
    hoverAnchor(anchor);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });
});
