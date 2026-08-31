import { render, screen, fireEvent, act } from '@testing-library/react';
import { MessageContext } from '~/Providers/MessageContext';
import { ChatContext } from '~/Providers/ChatContext';
import AskUserCall from '../Parts/AskUserCall';

const mockSubmit = jest.fn();
const mockShowToast = jest.fn();

jest.mock('~/hooks/Messages', () => ({
  useSubmitMessage: () => ({ submitMessage: mockSubmit }),
}));
jest.mock('@librechat/client', () => ({
  useToastContext: () => ({ showToast: mockShowToast }),
}));

const ARGS = JSON.stringify({
  questions: [
    { id: 'q1', prompt: 'Какой формат?', options: ['Сводка', 'Отчёт'] },
    { id: 'q2', prompt: 'Период?', options: ['Месяц', 'Год'] },
  ],
});

type Ctx = {
  isSubmitting?: boolean;
  isLatestMessage?: boolean;
  askAnswersInitial?: Record<string, string>;
  onAskAnswersChange?: (answers: Record<string, string>) => void;
};

const renderCall = (ctx: Ctx = {}, args = ARGS) =>
  render(
    <ChatContext.Provider value={{} as never}>
      <MessageContext.Provider
        value={{
          messageId: 'm1',
          isExpanded: true,
          isSubmitting: ctx.isSubmitting ?? false,
          isLatestMessage: ctx.isLatestMessage ?? true,
          askAnswersInitial: ctx.askAnswersInitial,
          onAskAnswersChange: ctx.onAskAnswersChange,
        }}
      >
        <AskUserCall args={args} />
      </MessageContext.Provider>
    </ChatContext.Provider>,
  );

describe('AskUserCall (interactive cards К3 + r25)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockSubmit.mockReset().mockReturnValue(undefined);
    mockShowToast.mockReset();
  });
  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  const answerBoth = () => {
    fireEvent.click(screen.getByRole('radio', { name: /Отчёт/ }));
    act(() => {
      jest.advanceTimersByTime(320);
    });
    fireEvent.click(screen.getByRole('radio', { name: /Месяц/ }));
  };

  it('submits ONE summary message with all answers on Continue', () => {
    renderCall();
    answerBoth();
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    expect(mockSubmit).toHaveBeenCalledTimes(1);
    expect(mockSubmit).toHaveBeenCalledWith({
      text: 'Ответы на вопросы:\n1) Какой формат? — Отчёт\n2) Период? — Месяц',
    });
  });

  it('submits the skip marker on Skip', () => {
    renderCall();
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(mockSubmit).toHaveBeenCalledWith({ text: 'Пропустить вопросы' });
  });

  it('r25: options are selectable while the tail text still streams — only the commit waits', () => {
    const onAskAnswersChange = jest.fn();
    renderCall({ isSubmitting: true, onAskAnswersChange });
    answerBoth();
    expect(onAskAnswersChange).toHaveBeenLastCalledWith({ q1: 'Отчёт', q2: 'Месяц' });

    const continueBtn = screen.getByRole('button', { name: /Continue/ });
    expect(continueBtn).toBeDisabled();
    fireEvent.click(continueBtn);
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeDisabled();
  });

  it('r25: seeded answers survive the finalization remount and Continue arms', () => {
    /* The remount hands the card the answers picked mid-stream (the map lives
     * in ContentParts) — Continue must be immediately live with them. */
    renderCall({ isSubmitting: false, askAnswersInitial: { q1: 'Отчёт', q2: 'Месяц' } });
    const continueBtn = screen.getByRole('button', { name: /Continue/ });
    expect(continueBtn).toBeEnabled();
    fireEvent.click(continueBtn);
    expect(mockSubmit).toHaveBeenCalledWith({
      text: 'Ответы на вопросы:\n1) Какой формат? — Отчёт\n2) Период? — Месяц',
    });
  });

  it('r25: a seeded answer outside the options re-selects «Другое…» with it', () => {
    renderCall({ askAnswersInitial: { q1: 'Свой вариант', q2: 'Месяц' } });
    expect(screen.getByDisplayValue('Свой вариант')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continue/ })).toBeEnabled();
  });

  it('r25: an answered card folds into the one-line summary (no frozen carousel)', () => {
    renderCall();
    answerBoth();
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    expect(screen.getByTestId('ask-user-collapsed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Continue/ })).toBeNull();
  });

  it('r25: a historical card renders as the folded line and reopens onto the questions', () => {
    renderCall({ isLatestMessage: false });
    const line = screen.getByTestId('ask-user-collapsed');
    expect(line).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Continue/ })).toBeNull();

    const toggle = screen.getByRole('button', { expanded: false });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Какой формат?')).toBeInTheDocument();
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('a refused submit keeps the card actionable and toasts', () => {
    mockSubmit.mockReturnValue(false);
    renderCall();
    answerBoth();
    const continueBtn = screen.getByRole('button', { name: /Continue/ });
    fireEvent.click(continueBtn);
    expect(mockShowToast).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Continue/ })).toBeInTheDocument();
    mockSubmit.mockReturnValue(undefined);
    fireEvent.click(continueBtn);
    expect(mockSubmit).toHaveBeenCalledTimes(2);
  });

  it('renders the folded line outside ChatContext — the share page must not crash (К4)', () => {
    render(
      <MessageContext.Provider value={{ messageId: 'm1', isExpanded: true }}>
        <AskUserCall args={ARGS} />
      </MessageContext.Provider>,
    );
    expect(screen.getByTestId('ask-user-collapsed')).toBeInTheDocument();
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('renders nothing while the args are still streaming', () => {
    const { container } = renderCall({}, '{"questions":[{"prom');
    expect(container).toBeEmptyDOMElement();
  });
});
