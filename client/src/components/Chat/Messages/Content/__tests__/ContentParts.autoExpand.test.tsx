import React from 'react';
import { ContentTypes } from 'librechat-data-provider';
import { render, screen } from '@testing-library/react';
import type { TMessageContentParts } from 'librechat-data-provider';

/**
 * Covers `autoExpandThinkIdx` in ContentParts: which part (if any) is told to
 * auto-expand when a message's reply lives entirely in the thinking channel.
 * Uses the real MessageContext so the flag is observed exactly the way
 * Reasoning consumes it.
 */

jest.mock('~/utils', () => ({
  mapAttachments: () => ({}),
  groupSequentialToolCalls: (parts: Array<{ part: unknown; idx: number }>) =>
    parts.map((p) => ({ type: 'single' as const, part: p })),
}));

jest.mock('../Parts', () => ({
  EditTextPart: () => <div data-testid="edit-text-part" />,
  EmptyText: () => <div data-testid="empty-text" />,
}));

jest.mock('../MemoryArtifacts', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../Parts/PendingSkillCall', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../ToolCallGroup', () => ({
  __esModule: true,
  default: () => <div data-testid="tool-call-group" />,
}));

jest.mock('../Container', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock('../Part', () => {
  const { useMessageContext } = jest.requireActual('~/Providers/MessageContext');
  const PartMock = ({ part }: { part: { type: string } }) => {
    const {
      partIndex,
      autoExpandReasoning,
      reasoningExpandedInitial,
      onReasoningExpandedChange,
      reasoningDurationMs,
      onReasoningStreamTick,
    } = useMessageContext();
    return (
      <div
        data-testid={`part-${partIndex}`}
        data-part-type={part.type}
        data-auto-expand={String(autoExpandReasoning === true)}
        data-reasoning-initial={String(reasoningExpandedInitial)}
        data-duration={String(reasoningDurationMs)}
        onClick={() => onReasoningExpandedChange?.(true)}
      >
        <button data-testid={`tick-${partIndex}`} onClick={() => onReasoningStreamTick?.()} />
      </div>
    );
  };
  return { __esModule: true, default: PartMock };
});

jest.mock('../ParallelContent', () => ({
  ParallelContentRenderer: () => <div data-testid="parallel-renderer" />,
}));

import ContentParts from '../ContentParts';

const baseProps = {
  messageId: 'msg-1',
  isLast: true,
  isSubmitting: false,
  isLatestMessage: true,
  isCreatedByUser: false,
};

const think = (value: string): TMessageContentParts =>
  ({ type: ContentTypes.THINK, think: value }) as unknown as TMessageContentParts;
const text = (value: string): TMessageContentParts =>
  ({ type: ContentTypes.TEXT, text: value }) as unknown as TMessageContentParts;
const toolCall = (): TMessageContentParts =>
  ({
    type: ContentTypes.TOOL_CALL,
    tool_call: { id: 'call-1', name: 'file_search' },
  }) as unknown as TMessageContentParts;

describe('ContentParts — auto-expand for replies hidden in the thinking channel', () => {
  it('flags only the last non-empty THINK part when the message has no text answer', () => {
    // The exact shape seen in prod (2026-07-28, deepseek v3.1): think → tool_call → think.
    render(
      <ContentParts {...baseProps} content={[think('planning'), toolCall(), think('the reply')]} />,
    );
    expect(screen.getByTestId('part-0')).toHaveAttribute('data-auto-expand', 'false');
    expect(screen.getByTestId('part-2')).toHaveAttribute('data-auto-expand', 'true');
  });

  it('flags nothing when any text part carries a real answer', () => {
    render(
      <ContentParts {...baseProps} content={[think('planning'), toolCall(), text('answer')]} />,
    );
    expect(screen.getByTestId('part-0')).toHaveAttribute('data-auto-expand', 'false');
    expect(screen.getByTestId('part-2')).toHaveAttribute('data-auto-expand', 'false');
  });

  it('treats an empty text placeholder as no answer', () => {
    render(<ContentParts {...baseProps} content={[text(''), think('the reply')]} />);
    expect(screen.getByTestId('part-1')).toHaveAttribute('data-auto-expand', 'true');
  });

  it('flags nothing while the message is still streaming', () => {
    render(
      <ContentParts
        {...baseProps}
        isSubmitting={true}
        content={[think('planning'), toolCall(), think('so far')]}
      />,
    );
    expect(screen.getByTestId('part-0')).toHaveAttribute('data-auto-expand', 'false');
    expect(screen.getByTestId('part-2')).toHaveAttribute('data-auto-expand', 'false');
  });

  it('ignores whitespace-only THINK parts', () => {
    render(
      <ContentParts {...baseProps} content={[think('   '), think('the reply'), toolCall()]} />,
    );
    expect(screen.getByTestId('part-0')).toHaveAttribute('data-auto-expand', 'false');
    expect(screen.getByTestId('part-1')).toHaveAttribute('data-auto-expand', 'true');
  });
});

describe('ContentParts — reasoning expansion survives the finalization remount (round 24)', () => {
  /* The part key carries messageId, which swaps from the intermediate id to
   * the server id when the stream finalizes — the whole part subtree
   * remounts. The expansion map in ContentParts must seed the remounted part
   * with the state the user chose during streaming. The Part mock reads the
   * context exactly the way Reasoning does. */
  it('re-seeds a user-expanded card after the provisional id swaps to the server id', () => {
    /* Real finalize shape: buildCreatedInitialResponse uses `${userMessageId}_`
     * (trailing underscore = provisional), the finalHandler swaps in the server
     * id — possibly in the same batched render that drops isSubmitting. */
    const { rerender } = render(
      <ContentParts
        {...baseProps}
        messageId="user-msg-1_"
        isSubmitting={true}
        content={[think('streaming thoughts')]}
      />,
    );
    const partBefore = screen.getByTestId('part-0');
    expect(partBefore).toHaveAttribute('data-reasoning-initial', 'undefined');
    // the user expands during streaming — Reasoning reports it upward
    partBefore.click();

    rerender(
      <ContentParts
        {...baseProps}
        messageId="server-id-1"
        isSubmitting={false}
        content={[think('streaming thoughts')]}
      />,
    );
    expect(screen.getByTestId('part-0')).toHaveAttribute('data-reasoning-initial', 'true');
  });

  it('clears the stored expansion when a DIFFERENT finished message renders', () => {
    const { rerender } = render(
      <ContentParts
        {...baseProps}
        messageId="user-msg-a_"
        isSubmitting={true}
        content={[think('a')]}
      />,
    );
    screen.getByTestId('part-0').click();
    rerender(
      <ContentParts
        {...baseProps}
        messageId="server-a"
        isSubmitting={false}
        content={[think('a')]}
      />,
    );
    expect(screen.getByTestId('part-0')).toHaveAttribute('data-reasoning-initial', 'true');
    // a genuinely different finished message through the same instance — state gone
    rerender(
      <ContentParts
        {...baseProps}
        messageId="server-b"
        isSubmitting={false}
        content={[think('b')]}
      />,
    );
    expect(screen.getByTestId('part-0')).toHaveAttribute('data-reasoning-initial', 'undefined');
  });
});

describe('ContentParts — thinking duration survives the finalization remount (К4)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('measures first→last tick and re-seeds «Думал N с» after the id swap', () => {
    const now = jest.spyOn(Date, 'now');
    const { rerender } = render(
      <ContentParts
        {...baseProps}
        messageId="user-msg-1_"
        isSubmitting={true}
        content={[think('streaming thoughts')]}
      />,
    );
    now.mockReturnValue(1_000);
    screen.getByTestId('tick-0').click();
    now.mockReturnValue(6_000);
    screen.getByTestId('tick-0').click();

    rerender(
      <ContentParts
        {...baseProps}
        messageId="server-id-1"
        isSubmitting={false}
        content={[think('streaming thoughts')]}
      />,
    );
    expect(screen.getByTestId('part-0')).toHaveAttribute('data-duration', '5000');
  });

  it('clears the measurement when a DIFFERENT finished message renders', () => {
    const now = jest.spyOn(Date, 'now');
    const { rerender } = render(
      <ContentParts
        {...baseProps}
        messageId="user-msg-a_"
        isSubmitting={true}
        content={[think('a')]}
      />,
    );
    now.mockReturnValue(1_000);
    screen.getByTestId('tick-0').click();
    now.mockReturnValue(3_000);
    screen.getByTestId('tick-0').click();
    rerender(
      <ContentParts
        {...baseProps}
        messageId="server-a"
        isSubmitting={false}
        content={[think('a')]}
      />,
    );
    expect(screen.getByTestId('part-0')).toHaveAttribute('data-duration', '2000');

    rerender(
      <ContentParts
        {...baseProps}
        messageId="server-b"
        isSubmitting={false}
        content={[think('b')]}
      />,
    );
    expect(screen.getByTestId('part-0')).toHaveAttribute('data-duration', 'undefined');
  });
});
