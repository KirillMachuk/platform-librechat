import React from 'react';
import { RecoilRoot } from 'recoil';
import { Provider as JotaiProvider, createStore } from 'jotai';
import { render as rtlRender, act, fireEvent, screen } from '@testing-library/react';
import type { TMessage } from 'librechat-data-provider';
import {
  drAutoStartAtom,
  drProgressByConvoId,
  markPlanArrivedLive,
  planArrivedLive,
} from '~/store/deepResearch';
import PlanCard from '../PlanCard';

const mockSubmit = jest.fn();
const mockShowToast = jest.fn();
/* The «run immediately» setting is a storage atom; its writes go through the platform's
 * storage helper. Reached lazily through a `mock`-prefixed name — a mock factory may not
 * touch globals directly. */
const mockWriteStoredValue = (key: string, value: string) => localStorage.setItem(key, value);

jest.mock('~/hooks/Messages', () => ({
  useSubmitMessage: () => ({ submitMessage: mockSubmit }),
}));
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));
jest.mock('~/common', () => ({ mainTextareaId: 'prompt-textarea' }));
const mockStop = jest.fn();
jest.mock('~/Providers', () => ({
  useChatContext: () => ({ stopGenerating: mockStop }),
}));
jest.mock('@librechat/client', () => ({
  useToastContext: () => ({ showToast: mockShowToast }),
  /* Passes its render through: the plate sits OVER the control, it does not
     replace it (canon §6.6). */
  TooltipAnchor: ({ render }: { description?: React.ReactNode; render?: React.ReactElement }) =>
    render ?? null,
  writeStoredValue: (key: string, value: string) => mockWriteStoredValue(key, value),
}));
jest.mock('librechat-data-provider', () => ({
  DR_START_MARKER: 'Начать исследование',
  DR_CANCEL_MARKER: 'Отменить исследование',
  parseDrPlanMessage: (text: string) => {
    const lines = String(text ?? '').split('\n');
    const title = (lines[0] ?? '').replace('**План исследования:**', '').trim();
    const steps = lines
      .filter((l) => /^\s*\d+\./.test(l))
      .map((l) => l.replace(/^\s*\d+\.\s*/, '').trim());
    return { title, steps };
  },
}));

const PLAN = '**План исследования:** Рынок CRM\n\n1. Собрать\n2. Сравнить';
const planMessage = (createdAt?: string): TMessage =>
  ({ messageId: 'r1', text: PLAN, createdAt }) as unknown as TMessage;

const START = { text: 'Начать исследование', parentMessageId: 'r1' };
const CANCEL = { text: 'Отменить исследование', parentMessageId: 'r1' };

type Props = React.ComponentProps<typeof PlanCard>;

/** The card reads the live snapshot from Recoil and the setting from jotai, so every
 *  render needs both roots; the jotai store is fresh per render so tests cannot leak
 *  the setting into one another. */
const renderPlan = (props: Props, { startRightAway = false } = {}) => {
  const store = createStore();
  store.set(drAutoStartAtom, startRightAway);
  const wrap = (p: Props) => (
    <JotaiProvider store={store}>
      <RecoilRoot>
        <PlanCard {...p} />
      </RecoilRoot>
    </JotaiProvider>
  );
  const utils = rtlRender(wrap(props));
  return { ...utils, store, rerender: (p: Props) => utils.rerender(wrap(p)) };
};
const render = (ui: React.ReactElement) => rtlRender(<RecoilRoot>{ui}</RecoilRoot>);

describe('PlanCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    // `clearAllMocks` clears calls but NOT return values, so a refusal set by one test would
    // leak into the next. `undefined` is what the real `submitMessage` returns on success.
    mockSubmit.mockReturnValue(undefined);
  });

  it('renders the title and steps', () => {
    const { getByText } = render(<PlanCard message={planMessage()} awaitingAction={false} />);
    expect(getByText('Рынок CRM')).toBeInTheDocument();
    expect(getByText('Собрать')).toBeInTheDocument();
    expect(getByText('Сравнить')).toBeInTheDocument();
  });

  describe('one card for the plan AND its run (owner r26)', () => {
    const withRun = (snapshot: Record<string, unknown> | null) => (
      <RecoilRoot
        initializeState={({ set }) => {
          set(drProgressByConvoId('c1'), snapshot as never);
        }}
      >
        <PlanCard
          message={planMessage()}
          awaitingAction={false}
          isRunning={snapshot != null}
          conversationId="c1"
        />
      </RecoilRoot>
    );

    it('the approved plan itself shows the live statuses and the Stop control', () => {
      rtlRender(
        withRun({
          phase: 'research',
          steps: ['Собрать', 'Сравнить'],
          action: 'Ищет источники',
          searches: 1,
          progress: 0.5,
          /* The step the RUN reported (r27) — the fraction no longer decides. */
          stepIndex: 1,
        }),
      );
      expect(screen.getByText('Собрать').closest('li')).toHaveAttribute('data-status', 'done');
      expect(screen.getByText('Сравнить').closest('li')).toHaveAttribute('data-status', 'active');
      expect(screen.getByTestId('dr-stop')).toHaveAttribute(
        'aria-label',
        'com_ui_deep_research_stop',
      );
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
      expect(screen.getByText('Ищет источники')).toBeInTheDocument();
    });

    it('offline freezes it: no active step, no action line', () => {
      rtlRender(
        withRun({
          phase: 'research',
          steps: ['Собрать', 'Сравнить'],
          action: 'Ищет источники',
          searches: 1,
          progress: 0.5,
          stepIndex: 1,
          stalled: true,
        }),
      );
      expect(screen.queryByText('Ищет источники')).not.toBeInTheDocument();
      expect(document.querySelector('li[data-status="active"]')).toBeNull();
      expect(screen.getByRole('status')).toHaveTextContent('com_ui_deep_research_offline');
    });

    it('a finished run leaves every step done, with no Stop and no progress bar', () => {
      rtlRender(
        <RecoilRoot>
          <PlanCard message={planMessage()} awaitingAction={false} outcome="report" />
        </RecoilRoot>,
      );
      expect(screen.getByText('Собрать').closest('li')).toHaveAttribute('data-status', 'done');
      expect(screen.getByText('Сравнить').closest('li')).toHaveAttribute('data-status', 'done');
      expect(screen.queryByTestId('dr-stop')).toBeNull();
      expect(screen.queryByRole('progressbar')).toBeNull();
    });

    it('the running step shimmers, and is never hidden behind «Ещё N»', () => {
      /* The plan's own well collapses past three steps; a step being worked
       * on inside the hidden rest would freeze the card on a stale preview. */
      const long =
        '**План исследования:** Рынок CRM\n\n1. Шаг 1\n2. Шаг 2\n3. Шаг 3\n4. Шаг 4\n5. Шаг 5';
      rtlRender(
        <RecoilRoot
          initializeState={({ set }) => {
            set(drProgressByConvoId('c1'), {
              phase: 'research',
              /* A live plan run always carries its steps on the wire — that is
               * the very field the standalone card stands down on, so the card
               * must claim exactly those snapshots and no others (r28 review:
               * an empty-steps snapshot is a run NOBODY draws). */
              steps: ['Шаг 1', 'Шаг 2', 'Шаг 3', 'Шаг 4', 'Шаг 5'],
              action: 'Идёт',
              searches: 1,
              progress: 0.9,
              stepIndex: 4,
            } as never);
          }}
        >
          <PlanCard
            message={{ messageId: 'r9', text: long } as never}
            awaitingAction={false}
            isRunning
            conversationId="c1"
          />
        </RecoilRoot>,
      );
      const active = screen.getByText('Шаг 5');
      expect(active.closest('li')).toHaveAttribute('data-status', 'active');
      expect(active.className).toContain('thinking-shimmer-paint');
      expect(document.querySelector('.todoCollapsed')).toBeNull();
    });

    it('a STOPPED run says so, and does not claim the steps are done', () => {
      /* Nobody knows how far it got, and «no status at all» would read as
       * «never started» (r26 review). */
      rtlRender(
        <RecoilRoot>
          <PlanCard message={planMessage()} awaitingAction={false} outcome="stopped" />
        </RecoilRoot>,
      );
      expect(screen.getByTestId('plan-stopped')).toHaveTextContent('com_ui_deep_research_stopped');
      expect(screen.getByText('Собрать').closest('li')).not.toHaveAttribute('data-status', 'done');
    });

    it('a plan that never ran keeps its resting look (no statuses at all)', () => {
      rtlRender(
        <RecoilRoot>
          <PlanCard message={planMessage()} awaitingAction={false} />
        </RecoilRoot>,
      );
      expect(screen.getByText('Собрать').closest('li')).not.toHaveAttribute('data-status');
      expect(screen.queryByTestId('dr-stop')).toBeNull();
    });
  });

  it('r25: a cancelled plan wears the «Отменено» badge instead of controls', () => {
    render(<PlanCard message={planMessage()} awaitingAction={false} cancelled />);
    expect(screen.getByTestId('plan-cancelled')).toHaveTextContent('com_ui_cards_cancelled');
    expect(screen.queryByRole('button', { name: 'com_ui_deep_research_cancel' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'com_ui_deep_research_start' })).toBeNull();
  });

  it('shows no controls once the plan has been acted on (awaitingAction=false)', () => {
    const { queryByText, queryByRole } = render(
      <PlanCard message={planMessage()} awaitingAction={false} />,
    );
    expect(queryByText('com_ui_deep_research_start')).toBeNull();
    expect(queryByRole('button', { name: 'com_ui_deep_research_cancel' })).toBeNull();
  });

  it('Начать sends the START marker under THIS plan, and is single-flight (2 clicks → 1 submit)', () => {
    const { getByText } = renderPlan({ message: planMessage(), awaitingAction: true });
    const startBtn = getByText('com_ui_deep_research_start');
    fireEvent.click(startBtn);
    fireEvent.click(startBtn);
    expect(mockSubmit).toHaveBeenCalledTimes(1);
    /* The parent is named, not left to the latest-message selector: the card knows
     * which message its command is about. */
    expect(mockSubmit).toHaveBeenCalledWith(START);
  });

  it('the header ✕ is named for what it does and sends the CANCEL marker under this plan', () => {
    /* «Отмена» alone was one of two ✕ with that caption on the same card, with opposite
     * consequences (design review 02.09, К1). The other ✕ went with the countdown. */
    const { getByRole } = renderPlan({ message: planMessage(), awaitingAction: true });
    expect(screen.getByTestId('dr-cancel')).toHaveAttribute(
      'aria-label',
      'com_ui_deep_research_cancel',
    );
    fireEvent.click(getByRole('button', { name: 'com_ui_deep_research_cancel' }));
    expect(mockSubmit).toHaveBeenCalledWith(CANCEL);
  });

  it('Редактировать shows the edit hint (not "press Start"), keeps the buttons, marks the mode', () => {
    const { getByText, getAllByText, getByRole } = renderPlan({
      message: planMessage(),
      awaitingAction: true,
    });
    fireEvent.click(getByText('com_ui_edit'));
    // Buttons stay — a mis-tap is never a dead end.
    expect(getByText('com_ui_deep_research_start')).toBeInTheDocument();
    expect(getByRole('button', { name: 'com_ui_deep_research_cancel' })).toBeInTheDocument();
    // The hint tells the user to describe the change in chat (task #21). It renders twice:
    // the visible line and the sr-only live region.
    expect(getAllByText('com_ui_deep_research_edit_hint').length).toBeGreaterThan(0);
    // The Edit button reads as the active mode.
    expect(getByText('com_ui_edit').closest('button')).toHaveAttribute('aria-pressed', 'true');
    // Nothing was sent — and Начать still works if they run as-is.
    expect(mockSubmit).not.toHaveBeenCalled();
    fireEvent.click(getByText('com_ui_deep_research_start'));
    expect(mockSubmit).toHaveBeenCalledWith(START);
  });

  it('a REFUSED Начать keeps the buttons — the card never goes blank on a busy chat', () => {
    // `submitMessage` returns false while another generation still streams. Marking the card
    // as acted anyway hid the buttons with nothing running: a dead end only F5 could clear
    // (the shipped bug the user hit — "план без кнопок").
    mockSubmit.mockReturnValue(false);
    const { getByText, getByRole } = renderPlan({ message: planMessage(), awaitingAction: true });
    fireEvent.click(getByText('com_ui_deep_research_start'));
    expect(mockSubmit).toHaveBeenCalledTimes(1);
    expect(getByText('com_ui_deep_research_start')).toBeInTheDocument();
    expect(getByRole('button', { name: 'com_ui_deep_research_cancel' })).toBeInTheDocument();
    // A button that visibly does nothing is the complaint being fixed — say why. These
    // buttons are not gated on isSubmitting the way the composer is, so this is the one
    // caller that has to speak. (Announcing at the call site is upstream's own pattern.)
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'com_ui_send_while_submitting' }),
    );

    // ...and the very same tap works once the chat frees up — no reload needed.
    mockSubmit.mockReturnValue(undefined);
    fireEvent.click(getByText('com_ui_deep_research_start'));
    expect(mockSubmit).toHaveBeenCalledTimes(2);
    expect(mockSubmit).toHaveBeenLastCalledWith(START);
  });

  describe('«Запускать исследование сразу» (r30 — the setting that replaced the 30 s countdown)', () => {
    const noButtons = () => {
      expect(screen.queryByText('com_ui_deep_research_start')).toBeNull();
      expect(screen.queryByRole('button', { name: 'com_ui_deep_research_cancel' })).toBeNull();
    };
    const buttons = () => {
      expect(screen.getByText('com_ui_deep_research_start')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'com_ui_deep_research_cancel' }),
      ).toBeInTheDocument();
    };

    it('with «run immediately» on, a plan that just arrived live starts itself once, with no buttons', () => {
      markPlanArrivedLive('r1');
      renderPlan({ message: planMessage(), awaitingAction: true }, { startRightAway: true });
      expect(mockSubmit).toHaveBeenCalledTimes(1);
      expect(mockSubmit).toHaveBeenCalledWith(START);
      /* Not even for a frame: the card of a plan about to start itself is not a control. */
      noButtons();
      expect(mockShowToast).not.toHaveBeenCalled();
      /* The arrival is spent by the start it permitted. */
      expect(planArrivedLive('r1')).toBe(false);
    });

    it('arms on the flip to actionable, not on mount (a follow-up plan card mounts non-actionable)', () => {
      /* The latestMessage atom that gates `awaitingAction` settles a render later than the
       * final that mounts the card — the follow-up-card path that once left the old
       * countdown dead (buttons, no timer). */
      markPlanArrivedLive('r1');
      const { rerender } = renderPlan(
        { message: planMessage(), awaitingAction: false },
        { startRightAway: true },
      );
      expect(mockSubmit).not.toHaveBeenCalled();
      rerender({ message: planMessage(), awaitingAction: true });
      expect(mockSubmit).toHaveBeenCalledTimes(1);
      expect(mockSubmit).toHaveBeenCalledWith(START);
      noButtons();
    });

    it('a plan loaded from history waits for a click — even with «run immediately» on', () => {
      /* No mark: this plan did not arrive through this tab's stream. Reopening an old,
       * unstarted plan must never launch a research nobody asked for today. */
      renderPlan({ message: planMessage(), awaitingAction: true }, { startRightAway: true });
      expect(mockSubmit).not.toHaveBeenCalled();
      buttons();
    });

    it('with the setting off, a live plan waits — and its arrival is spent, so flipping the setting later starts nothing', () => {
      markPlanArrivedLive('r1');
      const { store } = renderPlan({ message: planMessage(), awaitingAction: true });
      expect(mockSubmit).not.toHaveBeenCalled();
      buttons();
      expect(planArrivedLive('r1')).toBe(false);
      /* The decision was made when the plan became actionable; turning the setting on
       * while a plan has been waiting is not a request to launch it. */
      act(() => {
        store.set(drAutoStartAtom, true);
      });
      expect(mockSubmit).not.toHaveBeenCalled();
      buttons();
    });

    it('never wipes a draft: text in the composer keeps the buttons, silently', () => {
      /* A send through the composer path resets the form; someone who started typing while
       * the plan was being made keeps their words, and the plan waits for a click. */
      const textarea = document.createElement('textarea');
      textarea.id = 'prompt-textarea';
      textarea.value = 'уточни план: только РФ';
      document.body.appendChild(textarea);
      try {
        markPlanArrivedLive('r1');
        renderPlan({ message: planMessage(), awaitingAction: true }, { startRightAway: true });
        expect(mockSubmit).not.toHaveBeenCalled();
        buttons();
        expect(mockShowToast).not.toHaveBeenCalled();
      } finally {
        textarea.remove();
      }
    });

    it('a refused self-start (busy chat) keeps the buttons, silently, and does not retry', () => {
      mockSubmit.mockReturnValue(false);
      markPlanArrivedLive('r1');
      const { unmount } = renderPlan(
        { message: planMessage(), awaitingAction: true },
        { startRightAway: true },
      );
      expect(mockSubmit).toHaveBeenCalledTimes(1);
      buttons();
      /* Nobody pressed anything, so nothing to explain out loud — unlike a refused click. */
      expect(mockShowToast).not.toHaveBeenCalled();
      /* A fresh mount of the same card (navigating away and back) does not try again: the
       * arrival was spent by the first attempt. */
      unmount();
      mockSubmit.mockReturnValue(undefined);
      renderPlan({ message: planMessage(), awaitingAction: true }, { startRightAway: true });
      expect(mockSubmit).toHaveBeenCalledTimes(1);
      buttons();
    });
  });
});
