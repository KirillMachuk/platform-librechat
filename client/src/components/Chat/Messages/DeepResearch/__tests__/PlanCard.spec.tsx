import React from 'react';
import { render, act, fireEvent } from '@testing-library/react';
import type { TMessage } from 'librechat-data-provider';
import PlanCard from '../PlanCard';

const mockSubmit = jest.fn();
let mockStartupConfig:
  | { deepResearch?: { planGate: boolean; planAutoStartSec: number } }
  | undefined;

jest.mock('~/hooks/Messages', () => ({
  useSubmitMessage: () => ({ submitMessage: mockSubmit }),
}));
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));
jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: mockStartupConfig }),
}));
jest.mock('~/common', () => ({ mainTextareaId: 'prompt-textarea' }));
jest.mock('lucide-react', () => ({ Telescope: () => <svg data-testid="telescope" /> }));
jest.mock('@librechat/client', () => ({
  // Faithful enough to assert forwarded DOM props (aria-pressed/label, className); the real
  // Button drops the custom variant/size into class variants, so strip them off the mock.
  Button: ({
    children,
    variant: _variant,
    size: _size,
    ...rest
  }: React.ComponentProps<'button'> & { variant?: string; size?: string }) => (
    <button {...rest}>{children}</button>
  ),
}));
jest.mock('librechat-data-provider', () => ({
  DR_START_MARKER: '▶ Начать исследование',
  DR_CANCEL_MARKER: '✕ Отменить исследование',
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

describe('PlanCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    mockStartupConfig = undefined;
  });

  it('renders the title and steps', () => {
    const { getByText } = render(<PlanCard message={planMessage()} awaitingAction={false} />);
    expect(getByText('Рынок CRM')).toBeInTheDocument();
    expect(getByText('Собрать')).toBeInTheDocument();
    expect(getByText('Сравнить')).toBeInTheDocument();
  });

  it('shows no controls once the plan has been acted on (awaitingAction=false)', () => {
    const { queryByText } = render(<PlanCard message={planMessage()} awaitingAction={false} />);
    expect(queryByText('com_ui_deep_research_start')).toBeNull();
    expect(queryByText('com_ui_cancel')).toBeNull();
  });

  it('Начать sends the START marker, and is single-flight (2 clicks → 1 submit)', () => {
    const { getByText } = render(
      <PlanCard message={planMessage()} awaitingAction autoStartSec={0} />,
    );
    const startBtn = getByText('com_ui_deep_research_start');
    fireEvent.click(startBtn);
    fireEvent.click(startBtn);
    expect(mockSubmit).toHaveBeenCalledTimes(1);
    expect(mockSubmit).toHaveBeenCalledWith({ text: '▶ Начать исследование' });
  });

  it('Отменить sends the CANCEL marker', () => {
    const { getByText } = render(
      <PlanCard message={planMessage()} awaitingAction autoStartSec={0} />,
    );
    fireEvent.click(getByText('com_ui_cancel'));
    expect(mockSubmit).toHaveBeenCalledWith({ text: '✕ Отменить исследование' });
  });

  it('autostarts after the countdown elapses', () => {
    jest.useFakeTimers();
    render(
      <PlanCard message={planMessage(new Date().toISOString())} awaitingAction autoStartSec={2} />,
    );
    expect(mockSubmit).not.toHaveBeenCalled();
    // Advance one second per act() so React flushes the state update (and reschedules the
    // next tick) between fires — a single advanceTimersByTime wouldn't process the reschedule.
    for (let i = 0; i < 3; i++) {
      act(() => {
        jest.advanceTimersByTime(1000);
      });
    }
    expect(mockSubmit).toHaveBeenCalledWith({ text: '▶ Начать исследование' });
  });

  it('ticks down from the MOUNT time when the live message has no createdAt (prod bug)', () => {
    jest.useFakeTimers();
    // Live-streamed plan messages have no createdAt until persisted; recomputing the base
    // from Date.now() froze the counter at the full window and autostart never fired.
    render(<PlanCard message={planMessage(undefined)} awaitingAction autoStartSec={2} />);
    for (let i = 0; i < 3; i++) {
      act(() => {
        jest.advanceTimersByTime(1000);
      });
    }
    expect(mockSubmit).toHaveBeenCalledWith({ text: '▶ Начать исследование' });
  });

  it('keeps counting while the composer is merely FOCUSED but empty (prod bug)', () => {
    jest.useFakeTimers();
    const textarea = document.createElement('textarea');
    textarea.id = 'prompt-textarea';
    document.body.appendChild(textarea);
    textarea.focus();
    try {
      render(
        <PlanCard
          message={planMessage(new Date().toISOString())}
          awaitingAction
          autoStartSec={2}
        />,
      );
      for (let i = 0; i < 3; i++) {
        act(() => {
          jest.advanceTimersByTime(1000);
        });
      }
      // The composer keeps focus after sending a message — focus alone must not cancel.
      expect(mockSubmit).toHaveBeenCalledWith({ text: '▶ Начать исследование' });
    } finally {
      textarea.remove();
    }
  });

  it('reads the autostart window from startup config when no prop is given (R7)', () => {
    jest.useFakeTimers();
    mockStartupConfig = { deepResearch: { planGate: true, planAutoStartSec: 2 } };
    render(<PlanCard message={planMessage(new Date().toISOString())} awaitingAction />);
    for (let i = 0; i < 3; i++) {
      act(() => {
        jest.advanceTimersByTime(1000);
      });
    }
    expect(mockSubmit).toHaveBeenCalledWith({ text: '▶ Начать исследование' });
  });

  it('does NOT autostart while the user is composing in the main textarea (R3)', () => {
    jest.useFakeTimers();
    const textarea = document.createElement('textarea');
    textarea.id = 'prompt-textarea';
    textarea.value = 'уточни план: только РФ';
    document.body.appendChild(textarea);
    try {
      render(
        <PlanCard
          message={planMessage(new Date().toISOString())}
          awaitingAction
          autoStartSec={2}
        />,
      );
      for (let i = 0; i < 5; i++) {
        act(() => {
          jest.advanceTimersByTime(1000);
        });
      }
      expect(mockSubmit).not.toHaveBeenCalled();
    } finally {
      textarea.remove();
    }
  });

  it('does NOT autostart a plan whose window already elapsed (reopened much later)', () => {
    jest.useFakeTimers();
    const old = new Date(Date.now() - 120000).toISOString();
    render(<PlanCard message={planMessage(old)} awaitingAction autoStartSec={60} />);
    act(() => {
      jest.advanceTimersByTime(120000);
    });
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('keeps ticking when the client clock is BEHIND the server (createdAt in the future)', () => {
    jest.useFakeTimers();
    // Refetched messages carry a server createdAt; a client clock behind the server put
    // it in the local future. The old per-tick Math.min clamp pinned the counter at the
    // full window — same value → React bail-out → the timer never rescheduled (frozen
    // counter, autostart never fired). The anchor now clamps ONCE to mount time.
    const future = new Date(Date.now() + 90000).toISOString();
    render(<PlanCard message={planMessage(future)} awaitingAction autoStartSec={2} />);
    for (let i = 0; i < 3; i++) {
      act(() => {
        jest.advanceTimersByTime(1000);
      });
    }
    expect(mockSubmit).toHaveBeenCalledWith({ text: '▶ Начать исследование' });
  });

  it('Редактировать shows the edit hint (not "press Start"), keeps the buttons, marks the mode', () => {
    jest.useFakeTimers();
    const { getByText, getAllByText, queryByText } = render(
      <PlanCard message={planMessage(new Date().toISOString())} awaitingAction autoStartSec={2} />,
    );
    fireEvent.click(getByText('com_ui_edit'));
    // Buttons stay — a mis-tap is never a dead end.
    expect(getByText('com_ui_deep_research_start')).toBeInTheDocument();
    expect(getByText('com_ui_cancel')).toBeInTheDocument();
    // The hint tells the user to describe the change in chat (task #21) — the misleading
    // "press Start" autostart caption must NOT be what a plan edit shows.
    expect(getAllByText('com_ui_deep_research_edit_hint').length).toBeGreaterThan(0);
    expect(queryByText('com_ui_deep_research_autostart_cancelled')).not.toBeInTheDocument();
    // The Edit button reads as the active mode.
    expect(getByText('com_ui_edit').closest('button')).toHaveAttribute('aria-pressed', 'true');
    // Autostart is cancelled — it never fires — but Начать still works if they run as-is.
    for (let i = 0; i < 5; i++) {
      act(() => {
        jest.advanceTimersByTime(1000);
      });
    }
    expect(mockSubmit).not.toHaveBeenCalled();
    fireEvent.click(getByText('com_ui_deep_research_start'));
    expect(mockSubmit).toHaveBeenCalledWith({ text: '▶ Начать исследование' });
  });

  it('does NOT autostart when the server exposes no deepResearch config (rollback safety)', () => {
    jest.useFakeTimers();
    // planGate rolled back → /api/config stops exposing `deepResearch`. The old `?? 60`
    // fallback kept a live fuse burning on historical plan cards; the default is now 0
    // (manual buttons only).
    mockStartupConfig = undefined;
    render(<PlanCard message={planMessage(new Date().toISOString())} awaitingAction />);
    for (let i = 0; i < 5; i++) {
      act(() => {
        jest.advanceTimersByTime(1000);
      });
    }
    expect(mockSubmit).not.toHaveBeenCalled();
  });
});
