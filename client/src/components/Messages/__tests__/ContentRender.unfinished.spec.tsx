import React from 'react';
import { RecoilRoot } from 'recoil';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TMessage } from 'librechat-data-provider';
import ContentRender from '~/components/Messages/ContentRender';

/**
 * A Deep Research report whose GATHERING was cut short says nothing about it — owner
 * decision, 27.08.2026. A report written from less material is still a real synthesis, and
 * a self-deprecating line under it reads to a client as an unreliable platform rather than
 * as candour. The fact is not lost: the runner still stamps `unfinished` on the message and
 * still logs the reason, which is where truncated runs are counted.
 *
 * Two things must hold here, and only one of them is "no note".
 *
 * The second is that no ERROR appears in the vacated slot. `unfinished` is a general message
 * flag, and the platform's own indicator for it is a red `role="alert"` box prefixed «Не
 * удалось выполнить запрос. Сообщение об ошибке: …». Over a report that was written
 * successfully that is a false statement, and every truncated report already in the database
 * still carries the flag. Today this path is safe because the general indicator lives in
 * MessageContent, which serves plain-text messages, while every report carries structured
 * content parts and renders here — these tests are what notices if that ever changes.
 */
const mockResolveDrReport = jest.fn(() => null as { title: string } | null);

// The heavy cards are stubbed; `isTruncatedDrReport` comes from the REAL module.
// The card stub renders whatever it is handed, INCLUDING element props nobody should be
// passing any more — a stub that quietly swallowed extras would hide a re-added note.
jest.mock('~/components/Chat/Messages/DeepResearch', () => ({
  ...jest.requireActual('~/components/Chat/Messages/DeepResearch'),
  __esModule: true,
  PlanCard: () => <div />,
  RunningSlot: () => <div />,
  /* The stub reports every prop the card is handed beyond the two it legitimately takes.
   * The note used to travel as one of those extra props, so this is what notices if
   * anything is ever handed back to the card to render beside the report. */
  ReportCard: ({ children, ...rest }: { children?: React.ReactNode } & Record<string, unknown>) => (
    <div
      data-testid="report-card"
      data-extra-props={Object.keys(rest)
        .filter((key) => key !== 'title' && key !== 'text')
        .join(',')}
    >
      {children}
    </div>
  ),
  resolveDrReport: (...args: unknown[]) => mockResolveDrReport(...(args as [])),
}));

jest.mock('~/components/Chat/Messages/Content/ContentParts', () => ({
  __esModule: true,
  default: () => <div data-testid="content-parts" />,
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
jest.mock('~/components/Chat/Messages/Content/Files', () => ({
  __esModule: true,
  default: () => <div />,
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useAttachments: () => ({ attachments: undefined, searchResults: undefined }),
  useContentMetadata: () => ({ hasParallelContent: false }),
  useMessageActions: () => ({
    edit: false,
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

function messageWith(partial: Partial<TMessage>): TMessage {
  return {
    messageId: 'm1',
    conversationId: 'c1',
    parentMessageId: 'p1',
    isCreatedByUser: false,
    text: '# Отчёт',
    depth: 0,
    children: [],
    content: [{ type: 'text', text: '# Отчёт' }],
    ...partial,
  } as unknown as TMessage;
}

function renderMessage(msg: TMessage, isSubmitting = false) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <RecoilRoot>
      <QueryClientProvider client={queryClient}>
        <ContentRender
          message={msg}
          siblingIdx={0}
          siblingCount={1}
          setSiblingIdx={jest.fn()}
          currentEditId={null}
          setCurrentEditId={jest.fn()}
          isSubmitting={isSubmitting}
          chatContext={{ isSubmitting } as never}
        />
      </QueryClientProvider>
    </RecoilRoot>,
  );
}

const drReport = (partial: Partial<TMessage> = {}) =>
  messageWith({ drKind: 'report', ...partial } as Partial<TMessage>);

describe('ContentRender — a truncated Deep Research report is recorded, not announced', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveDrReport.mockReturnValue({ title: 'Отчёт' });
  });

  it('hands the card the report and nothing else', () => {
    renderMessage(drReport({ unfinished: true }));
    const card = screen.getByTestId('report-card');
    // The note used to ride to the card as a prop; anything handed back that way shows up
    // here by name rather than having to be recognised by what it renders.
    expect(card.getAttribute('data-extra-props')).toBe('');
    expect(screen.getByTestId('content-parts')).toBeInTheDocument();
  });

  /**
   * The half that is easy to lose. Removing a note is one line; removing it in a way that
   * lets the platform's red «Не удалось выполнить запрос» box take the vacated slot would be
   * strictly worse than the note ever was — and it would land on old reports too, since the
   * flag they carry is still in the database.
   */
  it('and puts no error box in its place', () => {
    renderMessage(drReport({ unfinished: true }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/Не удалось выполнить запрос/)).not.toBeInTheDocument();
  });

  it('says nothing on a legacy report that gets no card either', () => {
    mockResolveDrReport.mockReturnValue(null);
    renderMessage(drReport({ unfinished: true }));
    expect(screen.queryByTestId('report-card')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says nothing on a complete report', () => {
    renderMessage(drReport());
    const card = screen.getByTestId('report-card');
    expect(card.getAttribute('data-extra-props')).toBe('');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  /**
   * `unfinished` is also set on an ordinary chat answer the user stopped, and this component
   * renders those too. It has never drawn anything for them and must not start: that would
   * be a platform-wide change to one of the commonest actions there is, arriving as a side
   * effect of a Deep Research decision.
   */
  it('leaves an ordinary answer the user stopped exactly as it was', () => {
    mockResolveDrReport.mockReturnValue(null);
    renderMessage(messageWith({ unfinished: true }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByTestId('content-parts')).toBeInTheDocument();
  });
});
