import React from 'react';
import { RecoilRoot } from 'recoil';
import { render, screen } from '@testing-library/react';
import {
  ContentTypes,
  ASK_USER_TOOL,
  DR_START_MARKER,
  DR_CANCEL_MARKER,
  buildAskAnswersMessage,
} from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';
import { ShareMessagesProvider } from '~/components/Share/ShareMessagesProvider';
import { USER_BUBBLE_CLASS } from '~/components/Chat/Messages/ui/turn';
import Message from '~/components/Share/Message';

/**
 * The share page is a THIRD renderer of user messages, and it had neither chip:
 * a shared Deep Research conversation showed the raw «Начать исследование» where
 * the chat shows a pill, and a shared ask_user turn showed the raw answers dump.
 * Both rules now read the parent through `getMessages()`, which on this page comes
 * from `ShareMessagesProvider` — so the provenance rule stays a single rule instead
 * of being re-implemented per surface.
 */

const STARTED = 'com_ui_deep_research_started';
const CANCELLED = 'com_ui_deep_research_cancelled';
const ANSWERS_SENT = 'com_ui_cards_answers_sent';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useAttachments: () => ({ attachments: undefined, searchResults: undefined }),
}));
jest.mock('~/components/Chat/Messages/Content/MessageContent', () => ({
  __esModule: true,
  default: ({ text }: { text?: string }) => <div data-testid="share-body">{text}</div>,
}));
jest.mock('~/components/Chat/Messages/Content/SearchContent', () => ({
  __esModule: true,
  default: () => <div data-testid="share-search-content" />,
}));
jest.mock('~/components/Chat/Messages/MinimalHoverButtons', () => ({
  __esModule: true,
  default: () => <div />,
}));
jest.mock('~/components/Chat/Messages/SiblingSwitch', () => ({
  __esModule: true,
  default: () => <div />,
}));
jest.mock('~/components/Chat/Messages/SubRow', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
jest.mock('~/components/Share/MultiMessage', () => ({
  __esModule: true,
  default: () => <div />,
}));

const PARENT_ID = 'p1';

/** The exact shape `contentHasAskUserCall` reads; the union of real tool-call types
 *  is far wider than this fixture needs, so it is cast once, here. */
const ASK_USER_PARENT_CONTENT = [
  { type: 'tool_call', tool_call: { name: ASK_USER_TOOL } },
] as unknown as TMessage['content'];

function userMessage(partial: Partial<TMessage> = {}): TMessage {
  return {
    messageId: 'm1',
    conversationId: 'shared-conversation',
    parentMessageId: PARENT_ID,
    isCreatedByUser: true,
    text: DR_START_MARKER,
    depth: 1,
    children: [],
    ...partial,
  } as unknown as TMessage;
}

/**
 * Goes through the REAL `ShareMessagesProvider`, not a hand-built context: the wiring
 * from the shared message list to `getMessages()` is part of what is under test here.
 *
 * @param parent the shared list's parent turn — the provenance the rules read.
 */
function renderShared(msg: TMessage, parent?: Partial<TMessage>) {
  const messages = [{ messageId: PARENT_ID, isCreatedByUser: false, ...parent }, msg] as TMessage[];
  return render(
    <RecoilRoot>
      <ShareMessagesProvider messages={messages}>
        <Message
          message={msg}
          siblingIdx={0}
          siblingCount={1}
          setSiblingIdx={jest.fn()}
          currentEditId={null}
          setCurrentEditId={jest.fn()}
        />
      </ShareMessagesProvider>
    </RecoilRoot>,
  );
}

/**
 * The chip is its own pill; leaving it inside the grey user bubble draws a pill in a pill.
 * The bubble class carries arbitrary-value Tailwind tokens that are not valid CSS
 * selectors, so it is matched by its one distinctive plain token — and `bubbleGuard`
 * asserts that token is still part of the class, so a rename cannot leave this
 * measuring nothing.
 */
const BUBBLE_MARKER = 'bg-bubble';

function bubbleGuard(): void {
  expect(USER_BUBBLE_CLASS).toContain(BUBBLE_MARKER);
}

function bubbleCount(container: HTMLElement): number {
  bubbleGuard();
  return container.querySelectorAll(`[class*="${BUBBLE_MARKER}"]`).length;
}

describe('Share view — command and answers chips', () => {
  it('renders the DR start chip instead of the raw marker, outside the user bubble', () => {
    const { container } = renderShared(userMessage({ drKind: 'start' }), { drKind: 'plan' });
    expect(screen.getByText(STARTED)).toBeInTheDocument();
    expect(screen.queryByText(DR_START_MARKER)).not.toBeInTheDocument();
    expect(bubbleCount(container)).toBe(0);
  });

  it('renders the DR cancel chip', () => {
    renderShared(userMessage({ drKind: 'cancel', text: DR_CANCEL_MARKER }), { drKind: 'plan' });
    expect(screen.getByText(CANCELLED)).toBeInTheDocument();
    expect(screen.queryByText(DR_CANCEL_MARKER)).not.toBeInTheDocument();
  });

  it('renders the ask_user answers chip under a tool-bearing parent', () => {
    const text = buildAskAnswersMessage(
      [{ id: 'q1', prompt: 'Бюджет?', options: ['До 100 тысяч', 'Больше'] }],
      { q1: 'До 100 тысяч' },
    );
    renderShared(userMessage({ text }), { content: ASK_USER_PARENT_CONTENT });
    expect(screen.getByTestId('answers-chip')).toBeInTheDocument();
    expect(screen.getByText(ANSWERS_SENT)).toBeInTheDocument();
  });

  it('leaves marker-lookalike prose alone (parent is not a plan)', () => {
    renderShared(userMessage(), { drKind: 'report' });
    expect(screen.queryByText(STARTED)).not.toBeInTheDocument();
    expect(screen.getByTestId('share-body')).toHaveTextContent(DR_START_MARKER);
  });

  it('leaves an ordinary shared user message alone, still in its bubble', () => {
    const { container } = renderShared(userMessage({ text: 'обычный вопрос' }), { drKind: 'plan' });
    expect(screen.getByTestId('share-body')).toHaveTextContent('обычный вопрос');
    expect(screen.queryByText(STARTED)).not.toBeInTheDocument();
    expect(bubbleCount(container)).toBe(1);
  });

  it('keeps the assistant turn on its normal content path', () => {
    renderShared(
      userMessage({
        isCreatedByUser: false,
        drKind: undefined,
        content: [{ type: ContentTypes.TEXT, text: 'ответ' }],
      }),
      { drKind: 'plan' },
    );
    expect(screen.getByTestId('share-search-content')).toBeInTheDocument();
    expect(screen.queryByText(STARTED)).not.toBeInTheDocument();
  });
});
