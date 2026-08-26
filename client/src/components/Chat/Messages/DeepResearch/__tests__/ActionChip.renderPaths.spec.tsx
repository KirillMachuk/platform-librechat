import React from 'react';
import { RecoilRoot } from 'recoil';
import { render, screen, cleanup } from '@testing-library/react';
import { ContentTypes, DR_START_MARKER, DR_CANCEL_MARKER } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';
import type { MessagesViewContextValue } from '~/Providers/MessagesViewContext';
import { MessagesViewContext } from '~/Providers/MessagesViewContext';
import MultiMessage from '~/components/Chat/Messages/MultiMessage';

/**
 * The Deep Research command chip must reach BOTH user-message render paths.
 *
 * `MultiMessage` routes on `message.content`: a message that carries content parts
 * goes to ContentRender, everything else to MessageRender. The DR command messages
 * («Начать исследование» / «Отменить исследование») are built by
 * `getPreliminaryUserMessage` on the server and by `useChatFunctions` on the client,
 * and NEITHER gives them a `content` array — verified on the live stand, where all 30
 * persisted `drKind: start|cancel` messages have no `content` field. So the real
 * routing sends every one of them to MessageRender, which is exactly where the chip
 * was NOT mounted: the user saw the raw command text in a plain bubble.
 *
 * The tests below drive the REAL `MultiMessage`, so the routing decision is the
 * component's, not the test's. The content-bearing case is kept as the control that
 * was always green — it is what made the defect invisible.
 */

/* Asserting on the KEYS, not on the Russian text: a renamed key must break this
 * test, while a reworded translation must not. The mock localize below is what
 * makes the key the visible string. */
const STARTED = 'com_ui_deep_research_started';
const CANCELLED = 'com_ui_deep_research_cancelled';

jest.mock('~/components/Chat/Messages/DeepResearch', () => ({
  ...jest.requireActual('~/components/Chat/Messages/DeepResearch'),
  __esModule: true,
  PlanCard: () => <div />,
  RunningSlot: () => <div />,
  ReportCard: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

/**
 * The two renderers' bodies, kept DISTINGUISHABLE on purpose: asserting only
 * "a chip instead of text" would stay green if MultiMessage ever routed
 * everything through one path, which is the very confusion under test. Each
 * stand-in also honours `edit`, because that is what the pencil mounts.
 */
jest.mock('~/components/Chat/Messages/Content/MessageContent', () => ({
  __esModule: true,
  default: ({ text, edit }: { text?: string; edit?: boolean }) =>
    edit === true ? (
      <div data-testid="editor" />
    ) : (
      <div data-testid="message-render-body">{text}</div>
    ),
}));
jest.mock('~/components/Chat/Messages/Content/ContentParts', () => ({
  __esModule: true,
  default: ({ content, edit }: { content?: Array<{ text?: string }>; edit?: boolean }) =>
    edit === true ? (
      <div data-testid="editor" />
    ) : (
      <div data-testid="content-render-body">{content?.map((p) => p?.text).join('')}</div>
    ),
}));
jest.mock('~/components/Chat/Messages/Content/Files', () => ({
  __esModule: true,
  default: () => <div />,
}));
jest.mock('~/components/Chat/Messages/HoverButtons', () => ({
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
jest.mock('~/components/Chat/Messages/ui/PlaceholderRow', () => ({
  __esModule: true,
  default: () => <div />,
}));

const CONVO_ID = 'c1';

/** Steers `useMessageActions().edit` per test — the pencil's only observable input here.
 *  The `mock` prefix is what lets a jest.mock factory reach it. */
const mockEdit = { on: false };

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useAttachments: () => ({ attachments: undefined, searchResults: undefined }),
  useContentMetadata: () => ({ hasParallelContent: false }),
  useMessageProcess: () => ({
    conversation: { conversationId: 'c1' },
    handleScroll: jest.fn(),
    isSubmitting: false,
  }),
  useMemoizedChatContext: () => ({
    chatContext: { isSubmitting: false },
    effectiveIsSubmitting: false,
  }),
  useMessageActions: () => ({
    ask: jest.fn(),
    edit: mockEdit.on,
    index: 0,
    enterEdit: jest.fn(),
    conversation: { conversationId: 'c1' },
    handleContinue: jest.fn(),
    handleFeedback: jest.fn(),
    latestMessageId: 'm1',
    copyToClipboard: jest.fn(),
    regenerateMessage: jest.fn(),
    latestMessageDepth: 0,
  }),
}));

function command(partial: Partial<TMessage> = {}): TMessage {
  return {
    messageId: 'm1',
    conversationId: CONVO_ID,
    parentMessageId: 'p1',
    isCreatedByUser: true,
    text: DR_START_MARKER,
    depth: 0,
    children: [],
    ...partial,
  } as unknown as TMessage;
}

/**
 * @param parent seeds the message list the optimistic-command rule reads. It is the
 * SAME list the view renders from (`getMessages`), which is what lets the share page
 * reuse this rule without a chat cache.
 */
function renderTree(msg: TMessage, parent?: Partial<TMessage>) {
  const messages = parent ? ([{ messageId: 'p1', ...parent }] as TMessage[]) : [];
  const ctx = {
    conversation: null,
    conversationId: CONVO_ID,
    ask: () => {},
    regenerate: () => {},
    handleContinue: () => {},
    latestMessageId: 'm1',
    latestMessageDepth: 0,
    isSubmitting: false,
    abortScroll: false,
    setAbortScroll: () => {},
    index: 0,
    getMessages: () => messages,
    setMessages: () => {},
  } as unknown as MessagesViewContextValue;
  return render(
    <RecoilRoot>
      <MessagesViewContext.Provider value={ctx}>
        <MultiMessage
          messageId={null}
          messagesTree={[msg]}
          currentEditId={null}
          setCurrentEditId={jest.fn()}
        />
      </MessagesViewContext.Provider>
    </RecoilRoot>,
  );
}

describe('Deep Research command chip — both user-message render paths', () => {
  beforeEach(() => {
    mockEdit.on = false;
  });

  it('CONTROL: renders on the content[] path (ContentRender) — always did', () => {
    renderTree(
      command({ drKind: 'start', content: [{ type: ContentTypes.TEXT, text: DR_START_MARKER }] }),
    );
    expect(screen.getByText(STARTED)).toBeInTheDocument();
    expect(screen.queryByText(DR_START_MARKER)).not.toBeInTheDocument();
  });

  it('renders on the text-only path (MessageRender) — the shape prod actually stores', () => {
    renderTree(command({ drKind: 'start' }));
    expect(screen.getByText(STARTED)).toBeInTheDocument();
    expect(screen.queryByText(DR_START_MARKER)).not.toBeInTheDocument();
  });

  /** Pins the routing itself: a command with no `content` must reach MessageRender,
   *  one with content parts must reach ContentRender. Without this, a MultiMessage
   *  that sent everything down one path would leave the tests above green. */
  it('MultiMessage picks the path by `content`, and each path shows the chip', () => {
    renderTree(command({ drKind: 'start' }));
    expect(screen.queryByTestId('content-render-body')).not.toBeInTheDocument();
    expect(screen.getByText(STARTED)).toBeInTheDocument();
    cleanup();

    renderTree(command({ text: 'обычный вопрос' }));
    expect(screen.getByTestId('message-render-body')).toHaveTextContent('обычный вопрос');
    expect(screen.queryByTestId('content-render-body')).not.toBeInTheDocument();
    cleanup();

    renderTree(
      command({
        text: 'обычный вопрос',
        content: [{ type: ContentTypes.TEXT, text: 'обычный вопрос' }],
      }),
    );
    expect(screen.getByTestId('content-render-body')).toHaveTextContent('обычный вопрос');
    expect(screen.queryByTestId('message-render-body')).not.toBeInTheDocument();
  });

  /**
   * The pencil must still work. The chip replaces the whole message body, and
   * MessageContent is what hosts the edit textarea — so a chip that ignores `edit`
   * turns an armed, visible Edit button into a no-op: the bubble class drops, the
   * chip slides left, and nothing else happens. Editing was available on this path
   * before the chip arrived; it must survive it.
   */
  it('yields to the editor when the message is being edited', () => {
    mockEdit.on = true;
    renderTree(command({ drKind: 'start' }));
    expect(screen.getByTestId('editor')).toBeInTheDocument();
    expect(screen.queryByText(STARTED)).not.toBeInTheDocument();
  });

  it('yields to the editor on the content[] path too', () => {
    mockEdit.on = true;
    renderTree(
      command({ drKind: 'start', content: [{ type: ContentTypes.TEXT, text: DR_START_MARKER }] }),
    );
    expect(screen.getByTestId('editor')).toBeInTheDocument();
    expect(screen.queryByText(STARTED)).not.toBeInTheDocument();
  });

  it('renders the CANCEL chip on the text-only path', () => {
    renderTree(command({ drKind: 'cancel', text: DR_CANCEL_MARKER }));
    expect(screen.getByText(CANCELLED)).toBeInTheDocument();
    expect(screen.queryByText(DR_CANCEL_MARKER)).not.toBeInTheDocument();
  });

  /**
   * The caption follows the SAME field that admitted the chip. It used to be
   * re-derived from the message text, so a persisted `drKind: 'cancel'` whose text
   * was anything else announced «запущено» — a label asserting a state its own data
   * denies. Unreachable today (the runner stamps drKind only alongside the marker),
   * which is exactly why it needs a test rather than a reader's trust.
   */
  it('takes the caption from drKind, not from the text', () => {
    renderTree(command({ drKind: 'cancel', text: 'что-то совершенно другое' }));
    expect(screen.getByText(CANCELLED)).toBeInTheDocument();
    expect(screen.queryByText(STARTED)).not.toBeInTheDocument();
  });

  it('renders the OPTIMISTIC command (no drKind yet) under a plan parent', () => {
    // The live window between the click and the server save: the message has no
    // drKind, so the chip leans on the parent's drKind provenance.
    renderTree(command(), { drKind: 'plan', isCreatedByUser: false });
    expect(screen.getByText(STARTED)).toBeInTheDocument();
  });

  it('leaves marker-lookalike prose alone (no drKind, no plan parent)', () => {
    // The provenance rule: text that merely reads like the marker is still prose.
    renderTree(command(), { drKind: 'report', isCreatedByUser: false });
    expect(screen.queryByText(STARTED)).not.toBeInTheDocument();
    expect(screen.getByTestId('message-render-body')).toHaveTextContent(DR_START_MARKER);
  });

  it('leaves an ASSISTANT message with the same text alone', () => {
    renderTree(command({ isCreatedByUser: false, drKind: undefined }), {
      drKind: 'plan',
      isCreatedByUser: false,
    });
    expect(screen.queryByText(STARTED)).not.toBeInTheDocument();
  });
});
