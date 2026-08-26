import React from 'react';
import { RecoilRoot } from 'recoil';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TMessage } from 'librechat-data-provider';
import ContentRender from '~/components/Messages/ContentRender';

/**
 * "The answer may be incomplete" reached exactly one render path.
 *
 * The server has always marked a run whose GATHERING was cut short (token budget, round cap)
 * with `unfinished: true`. The hint that renders it lives in MessageContent, which serves
 * legacy plain-text messages — while every message carrying structured `content` parts, which
 * is every Deep Research report, renders through ContentRender, where nothing read the flag.
 * A truncated report therefore looked exactly as finished as a complete one, and the only
 * trace of the truncation stayed in the database.
 */
/**
 * The real ru string, so the tests assert what is SEEN rather than a key.
 *
 * The note has its OWN key now. The shared `com_ui_unfinished_message` describes three
 * possible causes — "ещё обрабатывался, был остановлен или достиг лимита" — and under a Deep
 * Research report two of them cannot happen: the message is final, and a user Stop produces a
 * different message with a different drKind. Saying three things when one is known is the
 * same fault this series exists to remove, pointed the other way.
 */
const UNFINISHED_TEXT =
  'Сбор материала для этого отчёта прервался раньше времени: исследование успело охватить не всё, что планировало. Сам отчёт написан по тому, что удалось собрать, — им можно пользоваться.';

const mockResolveDrReport = jest.fn(() => null as { title: string } | null);
// The heavy cards are stubbed, but TruncatedNote and isTruncatedDrReport come from the REAL
// module: they are what is under test here, and a stub would only assert itself.
jest.mock('~/components/Chat/Messages/DeepResearch', () => ({
  ...jest.requireActual('~/components/Chat/Messages/DeepResearch'),
  __esModule: true,
  PlanCard: () => <div />,
  RunningSlot: () => <div />,
  ReportCard: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="report-card">{children}</div>
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
  useLocalize: () => (key: string) =>
    key === 'com_ui_dr_report_truncated' ? UNFINISHED_TEXT : key,
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

describe('ContentRender — an incomplete Deep Research report says so', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveDrReport.mockReturnValue({ title: 'Отчёт' });
  });

  it('shows the hint on a report whose gathering was cut short', () => {
    renderMessage(drReport({ unfinished: true }));
    expect(screen.getByText(UNFINISHED_TEXT)).toBeInTheDocument();
  });

  /**
   * The notice must not be an ERROR.
   *
   * The obvious way to render it — reusing `UnfinishedMessage` — wraps this same sentence in
   * `ErrorMessage`, which produces a red `role="alert"` box prefixed with «Не удалось
   * выполнить запрос. Сообщение об ошибке: …». Under a report that was successfully written,
   * merely from less material, that is a false statement and worse than showing nothing.
   */
  it('presents it as a note, not as a failed request', () => {
    renderMessage(drReport({ unfinished: true }));
    expect(screen.getByTestId('dr-unfinished-notice')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/Не удалось выполнить запрос/)).not.toBeInTheDocument();
  });

  it('stays quiet on a complete report', () => {
    renderMessage(drReport());
    expect(screen.queryByTestId('dr-unfinished-notice')).not.toBeInTheDocument();
  });

  it('stays quiet while the report is still streaming', () => {
    // A message in flight is legitimately incomplete; the hint would fire on every run.
    renderMessage(drReport({ unfinished: true }), true);
    expect(screen.queryByTestId('dr-unfinished-notice')).not.toBeInTheDocument();
  });

  /**
   * The regression this component must NOT cause.
   *
   * `unfinished` is also set — and persisted — on an ordinary chat answer the user stopped.
   * This component renders those too, so an unqualified check would put a red alert box under
   * every answer anyone ever pressed Stop on: a platform-wide change to one of the commonest
   * actions there is, arriving as a side effect of a Deep Research fix.
   */
  it('stays quiet on an ordinary answer the user stopped', () => {
    mockResolveDrReport.mockReturnValue(null);
    renderMessage(messageWith({ unfinished: true }));
    expect(screen.queryByTestId('dr-unfinished-notice')).not.toBeInTheDocument();
  });

  it('stays quiet on a user message', () => {
    renderMessage(drReport({ unfinished: true, isCreatedByUser: true }));
    expect(screen.queryByTestId('dr-unfinished-notice')).not.toBeInTheDocument();
  });
});
