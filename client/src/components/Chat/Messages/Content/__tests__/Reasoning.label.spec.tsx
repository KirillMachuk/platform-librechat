import { RecoilRoot } from 'recoil';
import { render, screen, fireEvent } from '@testing-library/react';
import { MessageContext } from '~/Providers/MessageContext';
import Reasoning from '../Parts/Reasoning';

/** Round 24: one waiting word platform-wide. While thoughts stream the card
 *  header carries the same shimmering «Думаю…» as the pre-stream label (the
 *  word «Рассуждаю…» is gone); a finished card settles into «Мысли». */

const renderReasoning = (
  isSubmitting: boolean,
  extras: {
    reasoningExpandedInitial?: boolean;
    onReasoningExpandedChange?: (expanded: boolean) => void;
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

describe('Reasoning header label (round 24: one waiting word)', () => {
  it('streams under the shimmering «Думаю…» header', () => {
    renderReasoning(true);
    const label = screen.getByText(/думаю…|thinking…/i);
    expect(label).toBeInTheDocument();
    expect(label.className).toContain('thinking-shimmer-active');
    expect(screen.queryByText(/рассуждаю/i)).toBeNull();
  });

  it('reports expansion clicks to the store and seeds from it across remounts', () => {
    /* Independent review, round 24: the store was pinned only through a Part
     * mock — this drives the REAL Reasoning: the header click must report
     * upward, and reasoningExpandedInitial must seed the state. */
    const onReasoningExpandedChange = jest.fn();
    renderReasoning(true, { onReasoningExpandedChange });
    const button = screen.getByRole('button', { expanded: false });
    fireEvent.click(button);
    expect(onReasoningExpandedChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole('button', { expanded: true })).toBeInTheDocument();

    const seeded = renderReasoning(false, { reasoningExpandedInitial: true });
    expect(
      seeded.getAllByRole('button').some((b) => b.getAttribute('aria-expanded') === 'true'),
    ).toBe(true);
  });

  it('settles into a static «Мысли» once finished', () => {
    renderReasoning(false);
    const label = screen.getByText(/мысли|thoughts/i);
    expect(label).toBeInTheDocument();
    expect(label.className).not.toContain('thinking-shimmer-active');
  });
});
