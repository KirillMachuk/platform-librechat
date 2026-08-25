import { RecoilRoot } from 'recoil';
import { render, screen, fireEvent } from '@testing-library/react';
import { MessageContext } from '~/Providers/MessageContext';
import Reasoning from '../Parts/Reasoning';

/** Round 24: one waiting word platform-wide. While thoughts stream the block
 *  header carries the same shimmering «Думаю…» as the pre-stream label (the
 *  word «Рассуждаю…» is gone). Cards К4: the finished header reads
 *  «Думал N с» when the duration was measured this session, plain «Мысли»
 *  otherwise, and the stream preview is forced open until the thoughts end. */

const renderReasoning = (
  isSubmitting: boolean,
  extras: {
    reasoningExpandedInitial?: boolean;
    onReasoningExpandedChange?: (expanded: boolean) => void;
    reasoningDurationMs?: number;
  } = {},
) =>
  render(
    <RecoilRoot>
      <MessageContext.Provider
        value={{
          messageId: 'm1',
          isExpanded: true,
          isSubmitting,
          isLatestMessage: true,
          ...extras,
        }}
      >
        <Reasoning reasoning="<think>ход рассуждения модели</think>" isLast={true} />
      </MessageContext.Provider>
    </RecoilRoot>,
  );

describe('Reasoning header label (round 24 + cards К4)', () => {
  it('streams under the shimmering «Думаю…» header', () => {
    renderReasoning(true);
    const label = screen.getByText(/думаю…|thinking…/i);
    expect(label).toBeInTheDocument();
    expect(label.className).toContain('thinking-shimmer-active');
    expect(screen.queryByText(/рассуждаю/i)).toBeNull();
  });

  it('streams forced open and refuses the toggle until the thoughts end (К4)', () => {
    const onReasoningExpandedChange = jest.fn();
    renderReasoning(true, { onReasoningExpandedChange });
    const button = screen.getByRole('button', { expanded: true });
    fireEvent.click(button);
    expect(onReasoningExpandedChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { expanded: true })).toBeInTheDocument();
  });

  it('reports expansion clicks to the store and seeds from it across remounts', () => {
    /* Independent review, round 24: the store was pinned only through a Part
     * mock — this drives the REAL Reasoning: the header click must report
     * upward, and reasoningExpandedInitial must seed the state. */
    const onReasoningExpandedChange = jest.fn();
    renderReasoning(false, { onReasoningExpandedChange });
    const button = screen.getByRole('button', { expanded: false });
    fireEvent.click(button);
    expect(onReasoningExpandedChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole('button', { expanded: true })).toBeInTheDocument();

    const seeded = renderReasoning(false, { reasoningExpandedInitial: true });
    expect(
      seeded.getAllByRole('button').some((b) => b.getAttribute('aria-expanded') === 'true'),
    ).toBe(true);
  });

  it('settles into a static «Мысли» when no duration was measured (reload)', () => {
    renderReasoning(false);
    const label = screen.getByText(/мысли|thoughts/i);
    expect(label).toBeInTheDocument();
    expect(label.className).not.toContain('thinking-shimmer-active');
  });

  it('shows «Думал N с» when the duration was measured this session (К4)', () => {
    renderReasoning(false, { reasoningDurationMs: 5000 });
    expect(screen.getByRole('button')).toHaveTextContent(/(thought for 5s|думал 5 с)/i);
  });

  it('formats a long thinking as minutes + seconds (К4)', () => {
    renderReasoning(false, { reasoningDurationMs: 93_000 });
    expect(screen.getByRole('button')).toHaveTextContent(/(thought for 1m 33s|думал 1 мин 33 с)/i);
  });

  it('never shows «Думал 0 с» — sub-second thinking rounds up to 1 (К4)', () => {
    renderReasoning(false, { reasoningDurationMs: 120 });
    expect(screen.getByRole('button')).toHaveTextContent(/(thought for 1s|думал 1 с)/i);
  });
});
