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
    const { partIndex, autoExpandReasoning } = useMessageContext();
    return (
      <div
        data-testid={`part-${partIndex}`}
        data-part-type={part.type}
        data-auto-expand={String(autoExpandReasoning === true)}
      />
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
