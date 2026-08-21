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
jest.mock('~/components/Chat/Messages/Content/MessageContent', () => ({
  __esModule: true,
  default: () => <div />,
  UnfinishedMessage: () => <div data-testid="unfinished-hint" />,
}));

const mockResolveDrReport = jest.fn(() => null as { title: string } | null);
jest.mock('~/components/Chat/Messages/DeepResearch', () => ({
  __esModule: true,
  PlanCard: () => <div />,
  ActionChip: () => <div />,
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

describe('ContentRender — an incomplete answer says so', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveDrReport.mockReturnValue(null);
  });

  it('shows the hint for a finished message the server marked unfinished', () => {
    renderMessage(messageWith({ unfinished: true }));
    expect(screen.getByTestId('unfinished-hint')).toBeInTheDocument();
  });

  it('shows it on a Deep Research report card too — the path that never did', () => {
    mockResolveDrReport.mockReturnValue({ title: 'Отчёт' });
    renderMessage(messageWith({ unfinished: true, drKind: 'report' } as Partial<TMessage>));
    expect(screen.getByTestId('report-card')).toBeInTheDocument();
    expect(screen.getByTestId('unfinished-hint')).toBeInTheDocument();
  });

  it('stays quiet for a complete message', () => {
    renderMessage(messageWith({}));
    expect(screen.queryByTestId('unfinished-hint')).not.toBeInTheDocument();
  });

  it('stays quiet while the message is still streaming', () => {
    // A message in flight is legitimately incomplete; the hint would fire on every run.
    renderMessage(messageWith({ unfinished: true }), true);
    expect(screen.queryByTestId('unfinished-hint')).not.toBeInTheDocument();
  });

  it('stays quiet on a user message', () => {
    renderMessage(messageWith({ unfinished: true, isCreatedByUser: true }));
    expect(screen.queryByTestId('unfinished-hint')).not.toBeInTheDocument();
  });
});
