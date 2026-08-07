import React from 'react';
import { RecoilRoot } from 'recoil';
import { render, screen } from '@testing-library/react';
import ToolCall from '../ToolCall';

/**
 * What a person sees while a tool runs and after it finishes.
 *
 * The neighbouring `ToolCall.test.tsx` mocks `ProgressText` and `ToolCallInfo`
 * away, which is right for what it asserts — that the props are handed over —
 * and is also why nothing covered the rendering itself. A build where the status
 * line never left "running", or where the result was handed over and then not
 * drawn, passed everything.
 *
 * So this file mocks neither. It mocks only what a tool call cannot reach in
 * jsdom: the icon map, and the markdown renderer the output goes through.
 */
jest.mock('~/hooks/MCP', () => ({
  useMCPIconMap: () => new Map(),
}));

jest.mock('~/components/Chat/Messages/Content/MessageContent', () => ({
  __esModule: true,
  default: ({ content }: { content: string }) => <div data-testid="message-content">{content}</div>,
}));

const renderToolCall = (props: Partial<React.ComponentProps<typeof ToolCall>> = {}) =>
  render(
    <RecoilRoot>
      <ToolCall
        initialProgress={1}
        isSubmitting={false}
        name="weather_lookup"
        args='{"city":"Berlin"}'
        {...props}
      />
    </RecoilRoot>,
  );

describe('a tool call on screen', () => {
  it('says it is running while it runs', () => {
    renderToolCall({ initialProgress: 0.3, isSubmitting: true, output: null });

    /* Twice on purpose: the status is painted and, separately, announced in a
     * live region. Found the hard way — a single `getByText` dies of ambiguity
     * here — and worth keeping as an assertion, because a status a screen
     * reader never hears is a status half the readers never get. */
    const running = screen.getAllByText(/Running weather_lookup/);
    expect(running.length).toBeGreaterThan(1);
    expect(running.some((element) => element.closest('[aria-live]'))).toBe(true);

    /* And not the finished wording, which is the half that would still pass on a
     * build stuck at "running" if only the line above were asserted. */
    expect(screen.queryAllByText(/Ran weather_lookup/)).toHaveLength(0);
  });

  it('says it finished, and shows what came back', () => {
    renderToolCall({ output: 'It is 21 degrees and clear in Berlin.' });

    const finished = screen.getAllByText(/Ran weather_lookup/);
    expect(finished.length).toBeGreaterThan(1);
    expect(finished.some((element) => element.closest('[aria-live]'))).toBe(true);
    expect(screen.queryAllByText(/Running weather_lookup/)).toHaveLength(0);

    /* The result itself. `autoExpandTools` defaults on, so a finished call with
     * output opens its own panel — which is the behaviour a reader depends on
     * and the reason this assertion needs no click. */
    expect(screen.getByText('It is 21 degrees and clear in Berlin.')).toBeInTheDocument();
  });

  it('a call with nothing to show does not open an empty panel', () => {
    renderToolCall({ args: '', output: null, isLast: true });

    /* The control for the assertion above: with no input and no output there is
     * no panel at all, so "the result is on screen" cannot be satisfied by a
     * panel that is always there. */
    expect(screen.queryByTestId('message-content')).not.toBeInTheDocument();
  });
});
