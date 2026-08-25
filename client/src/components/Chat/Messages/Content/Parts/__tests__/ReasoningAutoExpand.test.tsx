import { fireEvent, render, screen } from '@testing-library/react';
import { MessageContext } from '~/Providers';
import Reasoning from '../Reasoning';

/**
 * Covers the auto-expand fallback for replies hidden in the thinking channel:
 * a completed message with THINK parts and no visible text renders as a folded
 * thinking block — ContentParts marks its last THINK part via
 * `autoExpandReasoning` and the Reasoning block must open itself exactly once.
 * Re-taught for cards К4: the block streams forced open, so the flag matters
 * only once the thoughts are finished.
 */

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useExpandCollapse: (isExpanded: boolean) => ({
    style: { display: 'grid', gridTemplateRows: isExpanded ? '1fr' : '0fr' },
    ref: { current: null },
  }),
}));

const renderReasoning = (contextValue: Record<string, unknown>) =>
  render(
    <MessageContext.Provider
      value={
        {
          messageId: 'msg-1',
          isExpanded: true,
          ...contextValue,
        } as never
      }
    >
      <Reasoning reasoning="the actual answer, hidden in reasoning" isLast={true} />
    </MessageContext.Provider>,
  );

describe('Reasoning auto-expand (reply hidden in the thinking channel)', () => {
  it('mounts expanded when the part is flagged (revisiting an old conversation)', () => {
    renderReasoning({ isSubmitting: false, autoExpandReasoning: true });
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
  });

  it('mounts collapsed without the flag', () => {
    renderReasoning({ isSubmitting: false, autoExpandReasoning: false });
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
  });

  it('expands when the flag arrives after streaming finishes', () => {
    const { rerender } = renderReasoning({
      isSubmitting: true,
      isLatestMessage: true,
      autoExpandReasoning: false,
    });
    /* К4: the stream preview is forced open — the flag has nothing to do yet. */
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');

    const finished = (autoExpand: boolean) => (
      <MessageContext.Provider
        value={
          {
            messageId: 'msg-1',
            isExpanded: true,
            isSubmitting: false,
            isLatestMessage: true,
            autoExpandReasoning: autoExpand,
          } as never
        }
      >
        <Reasoning reasoning="the actual answer, hidden in reasoning" isLast={true} />
      </MessageContext.Provider>
    );

    rerender(finished(false));
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');

    rerender(finished(true));
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
  });

  it('lets the user collapse it afterwards — the flag does not force it back open', () => {
    renderReasoning({ isSubmitting: false, autoExpandReasoning: true });
    const button = screen.getByRole('button');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });
});
