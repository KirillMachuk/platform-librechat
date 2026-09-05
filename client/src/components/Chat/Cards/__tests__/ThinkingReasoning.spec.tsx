import { render, fireEvent } from '@testing-library/react';
import { ThinkingReasoning, ThinkingWaitLabel } from '../ThinkingReasoning';

/* jsdom has no layout: rows report the height a real row of that many lines
 * would have (20px per line, two at most), so the measured geometry runs. */
let rowHeight = 40;
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      return (this as HTMLElement).classList.contains('trSentence') ? rowHeight : 0;
    },
  });
});
beforeEach(() => {
  rowHeight = 40;
});

/**
 * Guards for the vendored aicss thinking block (cards К4, §6.17): the stream
 * preview reveals clamped sentence rows and auto-scrolls behind the fade
 * masks; the finished block folds into the summary line and reopens onto the
 * FULL text; a block mounted already finished must not replay the entry
 * animation. CSS-module classes arrive via identity-obj-proxy, so assertions
 * see the raw keys (trSentence, trFull, …).
 */

const defaultProps = {
  streaming: false,
  expanded: false,
  onToggle: jest.fn(),
  shimmerLabel: 'Думаю…',
  doneVerb: 'Думал',
  doneSuffix: '5 с',
  ariaLabel: 'Мысли',
  contentId: 'think-1',
};

const sentence = (n: number) => `Это предложение номер ${n}, достаточно длинное для строки.`;
const textOf = (n: number) => Array.from({ length: n }, (_, i) => sentence(i + 1)).join(' ');

describe('ThinkingReasoning (cards К4)', () => {
  it('reveals sentences as clamped rows while streaming, and only grows', () => {
    const { container, rerender } = render(
      <ThinkingReasoning {...defaultProps} streaming={true} text={textOf(2)} />,
    );
    expect(container.querySelectorAll('.trSentence')).toHaveLength(2);
    expect(container.querySelector('.trFull')).toBeNull();

    rerender(<ThinkingReasoning {...defaultProps} streaming={true} text={textOf(3)} />);
    const rows = container.querySelectorAll('.trSentence');
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toBe(sentence(1));
  });

  it('is forced open without a chevron while streaming and refuses the toggle', () => {
    const onToggle = jest.fn();
    const { container, getByRole } = render(
      <ThinkingReasoning {...defaultProps} streaming={true} text={textOf(1)} onToggle={onToggle} />,
    );
    const header = getByRole('button');
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(container.querySelector('.trChevron')).toBeNull();
    fireEvent.click(header);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('caps the viewport at 180px and slides the stream up behind the masks', () => {
    const { container } = render(
      <ThinkingReasoning {...defaultProps} streaming={true} text={textOf(6)} />,
    );
    const viewport = container.querySelector<HTMLElement>('.trViewport');
    const stream = container.querySelector<HTMLElement>('.trStream');
    /* 6 rows: 6×40 + 5×4 = 260 > 180 → height pinned, stream pushed up so the
     * newest row sits FADE(16px) above the bottom edge: 180-16-260 = -96. */
    expect(viewport?.style.height).toBe('180px');
    expect(stream?.style.transform).toBe('translateY(-96px)');
    expect(viewport?.style.maskImage).toContain('linear-gradient');
  });

  it('one-line rows take one line: six of them fit without the cap or the slide', () => {
    rowHeight = 20;
    const { container } = render(
      <ThinkingReasoning
        text="A one. B two. C three. D four. E five. F six."
        streaming
        expanded
        onToggle={() => undefined}
        shimmerLabel="Думаю…"
        doneVerb="Думал"
        ariaLabel="Мысли"
        contentId="think-1"
      />,
    );
    expect(container.querySelectorAll('.trSentence')).toHaveLength(6);
    /* 6×20 + 5×4 = 140 < 180: no cap, no slide — and no empty line per row. */
    expect(container.querySelector<HTMLElement>('.trViewport')?.style.height).toBe('140px');
    expect(container.querySelector<HTMLElement>('.trStream')?.style.transform).toBe(
      'translateY(0px)',
    );
  });

  it('a finished text is paragraphs, one per double newline, with no empty line between', () => {
    const { container } = render(
      <ThinkingReasoning
        text={'First paragraph.\nStill first.\n\nSecond paragraph.\n\n\nThird.'}
        streaming={false}
        expanded
        onToggle={() => undefined}
        shimmerLabel="Думаю…"
        doneVerb="Думал"
        ariaLabel="Мысли"
        contentId="think-1"
      />,
    );
    const paragraphs = container.querySelectorAll('[data-testid="think-full"] .trPara');
    expect(Array.from(paragraphs).map((p) => p.textContent)).toEqual([
      'First paragraph.\nStill first.',
      'Second paragraph.',
      'Third.',
    ]);
  });

  it('grows the viewport with the content before the cap', () => {
    const { container } = render(
      <ThinkingReasoning {...defaultProps} streaming={true} text={textOf(2)} />,
    );
    const viewport = container.querySelector<HTMLElement>('.trViewport');
    expect(viewport?.style.height).toBe('84px');
    expect(container.querySelector<HTMLElement>('.trStream')?.style.transform).toBe(
      'translateY(0px)',
    );
  });

  it('finished: folds to the summary line and reopens onto the FULL text', () => {
    const onToggle = jest.fn();
    const longText = textOf(8);
    const { container, getByRole, rerender } = render(
      <ThinkingReasoning
        {...defaultProps}
        streaming={false}
        expanded={false}
        text={longText}
        onToggle={onToggle}
      />,
    );
    const header = getByRole('button');
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(header).toHaveTextContent('Думал 5 с');
    expect(container.querySelector('.trChevron')).not.toBeNull();

    fireEvent.click(header);
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(
      <ThinkingReasoning
        {...defaultProps}
        streaming={false}
        expanded={true}
        text={longText}
        onToggle={onToggle}
      />,
    );
    expect(getByRole('button')).toHaveAttribute('aria-expanded', 'true');
    const full = container.querySelector('.trFull');
    expect(full?.textContent).toBe(longText);
    expect(container.querySelectorAll('.trSentence')).toHaveLength(0);
  });

  it('shows the verb alone when no duration is known (reload / share)', () => {
    const { getByRole } = render(
      <ThinkingReasoning
        {...defaultProps}
        doneVerb="Мысли"
        doneSuffix={undefined}
        text={textOf(1)}
      />,
    );
    expect(getByRole('button')).toHaveTextContent(/^Мысли$/);
  });

  it('ONE waiting look: the streaming header IS the standalone waiting label (r27)', () => {
    /* The owner reported the same complaint twice — the waiting word appears in
     * one design and then swaps into another. r26 answered it by taking the
     * brain OFF the streaming header; r27 overturned that («нужно сделать
     * единый стандарт… сразу новая надпись с иконкой»). The contract is now
     * equality, not absence: whatever the standalone label renders, the
     * streaming header renders, character for character. Comparing the two
     * outputs is the guard — a change to either one alone turns it red. */
    const streamed = render(
      <ThinkingReasoning {...defaultProps} streaming={true} text={textOf(1)} />,
    );
    const header = streamed.container.querySelector('button');
    const standalone = render(<ThinkingWaitLabel label="Думаю…" />);
    const label = standalone.container.querySelector('[data-testid="waiting-label"]');

    expect(header?.innerHTML).toBe(label?.innerHTML);
    expect(header?.querySelector('.trBrain')).not.toBeNull();
    expect(header?.querySelector('.thinking-shimmer-active')?.textContent).toBe('Думаю…');
    /* The chevron is the one thing the wait does NOT get: it is a control, and
     * there is nothing to fold until the thoughts stop (owner r26 on the ⏎). */
    expect(header?.querySelector('.trChevron')).toBeNull();

    const finished = render(<ThinkingReasoning {...defaultProps} text={textOf(1)} />);
    expect(finished.container.querySelector('.trBrain')).not.toBeNull();
    expect(finished.container.querySelector('.trChevron')).not.toBeNull();
  });

  it('mounted finished is static; born streaming keeps its entry animation', () => {
    const { container } = render(<ThinkingReasoning {...defaultProps} text={textOf(1)} />);
    expect(container.querySelector('.tr')).toHaveAttribute('data-static', 'true');

    const born = render(<ThinkingReasoning {...defaultProps} streaming={true} text={textOf(1)} />);
    expect(born.container.querySelector('.tr')).not.toHaveAttribute('data-static');
  });
});
