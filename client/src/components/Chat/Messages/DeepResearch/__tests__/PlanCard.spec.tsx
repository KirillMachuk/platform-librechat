import React from 'react';
import { render, act, fireEvent } from '@testing-library/react';
import type { TMessage } from 'librechat-data-provider';
import PlanCard from '../PlanCard';

const mockSubmit = jest.fn();

jest.mock('~/hooks/Messages', () => ({
  useSubmitMessage: () => ({ submitMessage: mockSubmit }),
}));
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));
jest.mock('~/common', () => ({ mainTextareaId: 'prompt-textarea' }));
jest.mock('lucide-react', () => ({ Telescope: () => <svg data-testid="telescope" /> }));
jest.mock('@librechat/client', () => ({
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
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

  it('does NOT autostart a plan whose window already elapsed (reopened much later)', () => {
    jest.useFakeTimers();
    const old = new Date(Date.now() - 120000).toISOString();
    render(<PlanCard message={planMessage(old)} awaitingAction autoStartSec={60} />);
    act(() => {
      jest.advanceTimersByTime(120000);
    });
    expect(mockSubmit).not.toHaveBeenCalled();
  });
});
