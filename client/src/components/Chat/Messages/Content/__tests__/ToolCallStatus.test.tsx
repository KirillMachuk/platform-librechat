import React from 'react';
import { RecoilRoot } from 'recoil';
import { render, screen, fireEvent } from '@testing-library/react';
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

    /* The result, and the part a reader actually gets. `autoExpandTools`
     * defaults to FALSE (`client/src/store/settings.ts`), so the panel starts
     * collapsed and the output sits in the DOM behind `max-h-0`. An earlier
     * version asserted `toBeInTheDocument` here and was green on text nobody
     * could see; a review caught it, and switching to `toBeVisible` turned it
     * red, which is how the default was established rather than assumed. */
    const result = screen.getByText('It is 21 degrees and clear in Berlin.');
    expect(result).not.toBeVisible();

    /* The button, not the text: the status line is a `<button aria-expanded>`
     * and the words inside it are a `<span>`, so clicking the text hits a child
     * that carries no handler. */
    const toggle = screen.getAllByRole('button', { expanded: false })[0];
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(result).toBeVisible();
  });

  it('a call with nothing to show has nothing to expand', () => {
    renderToolCall({ args: '', output: null, isLast: true });

    /* The control for the assertion above: with no input and no output the
     * panel is not rendered at all, so "the result is on screen" cannot be
     * satisfied by a panel that is always there.
     *
     * This used to assert the absence of a `message-content` test id, which a
     * review showed cannot fail: `ToolCall` never renders `MessageContent`, so
     * the element was absent under every input. The parameters block below is
     * real — it comes from `ToolCallInfo`, which `ToolCall` mounts only when
     * there is input or output to show. */
    expect(screen.queryByText('Parameters')).not.toBeInTheDocument();
  });

  it('a call with input does have something to expand', () => {
    renderToolCall({ args: '{"city":"Berlin"}', output: null });

    /* And the other half, without which the assertion above passes on a build
     * where the panel never renders for anything. */
    expect(screen.getByText('Parameters')).toBeInTheDocument();
  });
});
