import React from 'react';
import { RecoilRoot } from 'recoil';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TMessage } from 'librechat-data-provider';
import type { MessagesViewContextValue } from '~/Providers/MessagesViewContext';
import { MessagesViewContext } from '~/Providers/MessagesViewContext';
import MultiMessage from '~/components/Chat/Messages/MultiMessage';
import { drProgressByConvoId } from '~/store/deepResearch';
import { ChatContext } from '~/Providers/ChatContext';

/**
 * WHICH plan card owns a live run — the wiring, not the card.
 *
 * The r26 review measured that the first predicate («this plan has a start
 * command AND isSubmitting») can never be true: a plan with a start command
 * has a child, so it is never the latest message, and the isSubmitting that
 * reaches ContentRender is already `isLatestMessage ? isSubmitting : false`.
 * With the standalone running card stepped aside for plan runs, that left a
 * multi-minute research drawing nothing — and every guard stayed green,
 * because they all fed PlanCard its props directly.
 *
 * These drive the REAL MultiMessage → ContentRender → PlanCard chain.
 */

jest.mock('~/components/Chat/Messages/Content/ContentParts', () => ({
  __esModule: true,
  default: () => <div data-testid="content-parts" />,
}));
jest.mock('~/components/Chat/Messages/HoverButtons', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('~/components/Chat/Messages/SiblingSwitch', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('~/components/Chat/Messages/SubRow', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
jest.mock('~/components/Chat/Messages/ui/PlaceholderRow', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('~/components/Chat/Messages/Content/Files', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('~/hooks/Messages/useSubmitMessage', () => ({
  __esModule: true,
  default: () => ({ submitMessage: jest.fn() }),
}));
jest.mock('~/hooks/AuthContext', () => ({
  useAuthContext: () => ({ user: { id: 'u1' }, token: 't', isAuthenticated: true }),
  AuthContextProvider: ({ children }: { children?: React.ReactNode }) => children,
}));
jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: { deepResearch: { planGate: true, planAutoStartSec: 0 } } }),
}));

const PLAN_TEXT = '**План исследования:** Рынок CRM\n\n1. Собрать\n2. Сравнить';
const CONVO = 'c-run';

/**
 * The start command as the CLIENT holds it while the run is live.
 *
 * `drKind: 'start'` is stamped server-side AFTER the `created` event goes out,
 * so during the whole run the client's copy has only the marker text — it grows
 * the field on finalization or on reload. Every guard here used the persisted
 * shape, which is why a rule keyed on `drKind` could pass them all and still
 * leave a live research drawing nothing (r27 review). `persisted: true` opts
 * into the after-the-fact shape.
 */
const tree = (over: {
  latestId: string;
  runReply?: Partial<TMessage>;
  cancelInstead?: boolean;
  persisted?: boolean;
}): TMessage[] => {
  const reply = {
    messageId: 'resp1',
    conversationId: CONVO,
    parentMessageId: 'start1',
    isCreatedByUser: false,
    text: '',
    content: [],
    depth: 2,
    children: [],
    ...over.runReply,
  } as unknown as TMessage;
  const cancelReply = {
    messageId: 'cancel-reply',
    conversationId: CONVO,
    parentMessageId: 'cancel1',
    isCreatedByUser: false,
    text: 'Исследование отменено.',
    content: [{ type: 'text', text: 'Исследование отменено.' }],
    depth: 2,
    children: [],
  } as unknown as TMessage;
  const start = over.cancelInstead
    ? ({
        messageId: 'cancel1',
        conversationId: CONVO,
        parentMessageId: 'plan1',
        isCreatedByUser: true,
        drKind: 'cancel',
        text: 'Отменить исследование',
        depth: 1,
        children: [cancelReply],
      } as unknown as TMessage)
    : ({
        messageId: 'start1',
        conversationId: CONVO,
        parentMessageId: 'plan1',
        isCreatedByUser: true,
        ...(over.persisted === true ? { drKind: 'start' } : {}),
        text: 'Начать исследование',
        depth: 1,
        children: [reply],
      } as unknown as TMessage);
  return [
    {
      messageId: 'plan1',
      conversationId: CONVO,
      parentMessageId: null,
      isCreatedByUser: false,
      drKind: 'plan',
      text: PLAN_TEXT,
      /* MultiMessage routes on `content`: without it the plan message goes to
       * MessageRender and never reaches the card branch at all. */
      content: [{ type: 'text', text: PLAN_TEXT }],
      depth: 0,
      children: [start],
    } as unknown as TMessage,
  ];
};

const flatten = (nodes: TMessage[]): TMessage[] =>
  nodes.flatMap((n) => [n, ...flatten((n.children ?? []) as TMessage[])]);

const renderTree = (opts: {
  latestId: string;
  snapshot?: unknown;
  runReply?: Partial<TMessage>;
  cancelInstead?: boolean;
  persisted?: boolean;
}) =>
  renderCustom(
    tree({
      latestId: opts.latestId,
      runReply: opts.runReply,
      cancelInstead: opts.cancelInstead,
      persisted: opts.persisted,
    }),
    opts.latestId,
    opts.snapshot,
  );

const renderCustom = (messagesTree: TMessage[], latestId: string, snapshot?: unknown) => {
  const opts = { latestId, snapshot };
  const ctx = {
    conversation: { conversationId: CONVO },
    conversationId: CONVO,
    ask: () => {},
    regenerate: () => {},
    handleContinue: () => {},
    latestMessageId: opts.latestId,
    latestMessageDepth: 2,
    isSubmitting: opts.snapshot != null,
    abortScroll: false,
    setAbortScroll: () => {},
    index: 0,
    getMessages: () => flatten(messagesTree),
    setMessages: () => {},
  } as unknown as MessagesViewContextValue;

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RecoilRoot
        initializeState={({ set }) => {
          if (opts.snapshot != null) {
            set(drProgressByConvoId(CONVO), opts.snapshot as never);
          }
        }}
      >
        <ChatContext.Provider
          value={
            {
              stopGenerating: jest.fn(),
              conversation: { conversationId: CONVO },
              latestMessageId: opts.latestId,
              latestMessageDepth: 2,
              isSubmitting: opts.snapshot != null,
              ask: () => {},
              regenerate: () => {},
              handleContinue: () => {},
              index: 0,
              getMessages: () => flatten(messagesTree),
              setMessages: () => {},
            } as never
          }
        >
          <MessagesViewContext.Provider value={ctx}>
            <MultiMessage
              messageId={null}
              messagesTree={messagesTree}
              currentEditId={null}
              setCurrentEditId={jest.fn()}
            />
          </MessagesViewContext.Provider>
        </ChatContext.Provider>
      </RecoilRoot>
    </QueryClientProvider>,
  );
};

const RUNNING = {
  phase: 'research',
  steps: ['Собрать', 'Сравнить'],
  action: 'Ищет источники',
  searches: 1,
  progress: 0.5,
  /* The step the RUN reported (r27). It used to be derived from `progress`,
   * which on this very snapshot would put the card on step 2 of 2 and tick
   * step 1 off — while the run had only just started. */
  stepIndex: 1,
};

describe('which plan card draws a live Deep Research run (r26 review)', () => {
  it('the plan whose start command leads to the active tail shows the run', () => {
    renderTree({ latestId: 'resp1', snapshot: RUNNING });
    expect(screen.getByText('Собрать').closest('li')).toHaveAttribute('data-status', 'done');
    expect(screen.getByText('Сравнить').closest('li')).toHaveAttribute('data-status', 'active');
    expect(screen.getByTestId('dr-stop')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  });

  it('the SAME run, reloaded (drKind now stamped), still belongs to the same card', () => {
    renderTree({ latestId: 'resp1', snapshot: RUNNING, persisted: true });
    expect(screen.getByTestId('dr-stop')).toBeInTheDocument();
    expect(screen.getByText('Сравнить').closest('li')).toHaveAttribute('data-status', 'active');
  });

  it('a run that reports NO step marks none — the fraction must not fill in for it', () => {
    /* The defect (owner r27): the index came from `floor(progress × steps)`, so
     * a snapshot like this one — a live run, half the bar, no step reported —
     * painted step 2 active and step 1 done. Nothing on the wire knew that. */
    const { stepIndex: _dropped, ...noStep } = RUNNING;
    renderTree({ latestId: 'resp1', snapshot: noStep });
    expect(screen.getByText('Собрать').closest('li')).not.toHaveAttribute('data-status', 'done');
    expect(screen.getByText('Сравнить').closest('li')).not.toHaveAttribute('data-status', 'active');
    /* The run is still visibly a run: Stop and the bar stay. */
    expect(screen.getByTestId('dr-stop')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  });

  it('the reported step is followed even when the fraction disagrees', () => {
    renderTree({ latestId: 'resp1', snapshot: { ...RUNNING, progress: 0.95, stepIndex: 0 } });
    expect(screen.getByText('Собрать').closest('li')).toHaveAttribute('data-status', 'active');
    expect(screen.getByText('Сравнить').closest('li')).not.toHaveAttribute('data-status', 'done');
  });

  it('a SECOND research does not also light up the first plan card (r27)', () => {
    /* Stop → comment → re-plan → Start leaves the first plan's start command in
     * the ancestry of the second run's tail. A walk that answered «is this
     * start command anywhere above me» said yes to BOTH plans, so the old card
     * drew the new run: its Stop, its bar, and its step index applied to a
     * different list of steps. The nearest start command owns the run. */
    const PLAN2 = '**План исследования:** Погода\n\n1. Нормы\n2. Температуры';
    const node = (over: Record<string, unknown>) =>
      ({ conversationId: CONVO, children: [], ...over }) as unknown as TMessage;
    const reply2 = node({
      messageId: 'resp2',
      parentMessageId: 'start2',
      isCreatedByUser: false,
      text: '',
      content: [],
      depth: 5,
    });
    const start2 = node({
      messageId: 'start2',
      parentMessageId: 'plan2',
      isCreatedByUser: true,
      drKind: 'start',
      text: 'Начать исследование',
      depth: 4,
      children: [reply2],
    });
    const plan2 = node({
      messageId: 'plan2',
      parentMessageId: 'aborted1',
      isCreatedByUser: false,
      drKind: 'plan',
      text: PLAN2,
      content: [{ type: 'text', text: PLAN2 }],
      depth: 3,
      children: [start2],
    });
    const aborted1 = node({
      messageId: 'aborted1',
      parentMessageId: 'start1',
      isCreatedByUser: false,
      drKind: 'aborted',
      text: 'Исследование остановлено.',
      content: [],
      depth: 2,
      children: [plan2],
    });
    const start1 = node({
      messageId: 'start1',
      parentMessageId: 'plan1',
      isCreatedByUser: true,
      drKind: 'start',
      text: 'Начать исследование',
      depth: 1,
      children: [aborted1],
    });
    const messagesTree = [
      node({
        messageId: 'plan1',
        parentMessageId: null,
        isCreatedByUser: false,
        drKind: 'plan',
        text: PLAN_TEXT,
        content: [{ type: 'text', text: PLAN_TEXT }],
        depth: 0,
        children: [start1],
      }),
    ];
    renderCustom(messagesTree, 'resp2', {
      phase: 'research',
      steps: ['Нормы', 'Температуры'],
      action: 'Исследует',
      searches: 1,
      progress: 0.5,
      stepIndex: 1,
    });

    /* The SECOND plan runs: its own second step is active. */
    expect(screen.getByText('Температуры').closest('li')).toHaveAttribute('data-status', 'active');
    /* The FIRST plan is done with — it wears «Остановлено», not a live run. */
    expect(screen.getByText('Собрать').closest('li')).not.toHaveAttribute('data-status', 'done');
    expect(screen.getByTestId('plan-stopped')).toBeInTheDocument();
    expect(screen.getAllByTestId('dr-stop')).toHaveLength(1);
  });

  it('a RE-PLAN turn does not light the stopped plan card either (r27)', () => {
    /* After a Stop the user comments and the runner re-plans. That turn's user
     * message is a plain comment, not a start command — but the first plan's
     * start command is still an ancestor of it, so an ancestry-only rule made
     * the stopped card sprout a Stop button and a progress bar while the model
     * was merely writing a new plan. */
    const node = (over: Record<string, unknown>) =>
      ({ conversationId: CONVO, children: [], ...over }) as unknown as TMessage;
    const replanReply = node({
      messageId: 'replan',
      parentMessageId: 'comment1',
      isCreatedByUser: false,
      text: '',
      content: [],
      depth: 4,
    });
    const comment1 = node({
      messageId: 'comment1',
      parentMessageId: 'aborted1',
      isCreatedByUser: true,
      text: 'добавь ещё шаг про цены',
      depth: 3,
      children: [replanReply],
    });
    const aborted1 = node({
      messageId: 'aborted1',
      parentMessageId: 'start1',
      isCreatedByUser: false,
      drKind: 'aborted',
      text: 'Исследование остановлено.',
      content: [],
      depth: 2,
      children: [comment1],
    });
    const start1 = node({
      messageId: 'start1',
      parentMessageId: 'plan1',
      isCreatedByUser: true,
      drKind: 'start',
      text: 'Начать исследование',
      depth: 1,
      children: [aborted1],
    });
    renderCustom(
      [
        node({
          messageId: 'plan1',
          parentMessageId: null,
          isCreatedByUser: false,
          drKind: 'plan',
          text: PLAN_TEXT,
          content: [{ type: 'text', text: PLAN_TEXT }],
          depth: 0,
          children: [start1],
        }),
      ],
      'replan',
      { phase: 'plan', steps: [], action: '', searches: 0, progress: 0 },
    );

    expect(screen.queryByTestId('dr-stop')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByTestId('plan-stopped')).toBeInTheDocument();
  });

  it('with no run in flight the same card is just a plan', () => {
    renderTree({ latestId: 'resp1' });
    expect(screen.getByText('Собрать').closest('li')).not.toHaveAttribute('data-status');
    expect(screen.queryByTestId('dr-stop')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('a finished run leaves every step done and takes the Stop away', () => {
    renderTree({
      latestId: 'resp1',
      runReply: { drKind: 'report', text: 'Отчёт', content: [] } as Partial<TMessage>,
    });
    expect(screen.getByText('Собрать').closest('li')).toHaveAttribute('data-status', 'done');
    expect(screen.getByText('Сравнить').closest('li')).toHaveAttribute('data-status', 'done');
    expect(screen.queryByTestId('dr-stop')).toBeNull();
  });

  it('the «Исследование отменено.» notice is not drawn under the badge', () => {
    /* The plan card wears «Отменено»; a full-width paragraph repeating it is
     * duplication (owner r26). The message itself stays in the tree. */
    renderTree({
      latestId: 'cancel-reply',
      cancelInstead: true,
    });
    expect(screen.queryByTestId('content-parts')).toBeNull();
    expect(screen.getByTestId('plan-cancelled')).toBeInTheDocument();
  });

  it('prose that merely equals the notice text, with no cancel parent, still renders', () => {
    renderTree({ latestId: 'resp1', runReply: { text: 'Исследование отменено.' } });
    expect(screen.getByTestId('content-parts')).toBeInTheDocument();
  });

  it('a stopped run says «Остановлено» instead of reading as never started', () => {
    renderTree({
      latestId: 'resp1',
      runReply: {
        drKind: 'aborted',
        text: 'Исследование остановлено.',
        content: [],
      } as Partial<TMessage>,
    });
    expect(screen.getByTestId('plan-stopped')).toBeInTheDocument();
    expect(screen.getByText('Собрать').closest('li')).not.toHaveAttribute('data-status', 'done');
  });
});
