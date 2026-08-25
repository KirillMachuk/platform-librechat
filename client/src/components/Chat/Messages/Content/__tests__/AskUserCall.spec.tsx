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

const renderCall = (ctx: { isSubmitting?: boolean; isLatestMessage?: boolean } = {}, args = ARGS) =>
  render(
    <ChatContext.Provider value={{} as never}>
      <MessageContext.Provider
        value={{
          messageId: 'm1',
          isExpanded: true,
          isSubmitting: ctx.isSubmitting ?? false,
          isLatestMessage: ctx.isLatestMessage ?? true,
        }}
      >
        <AskUserCall args={args} />
      </MessageContext.Provider>
    </ChatContext.Provider>,
  );

describe('AskUserCall (interactive cards К3)', () => {
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

  it('submits ONE summary message with all answers on Continue', () => {
    renderCall();
    fireEvent.click(screen.getByRole('radio', { name: /Отчёт/ }));
    act(() => {
      jest.advanceTimersByTime(320);
    });
    fireEvent.click(screen.getByRole('radio', { name: /Месяц/ }));
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

  it('renders statically (no actions) when the message is no longer the latest', () => {
    renderCall({ isLatestMessage: false });
    expect(screen.getByText('Какой формат?')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Continue/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
  });

  it('stays interactive-less while the run is still streaming', () => {
    renderCall({ isSubmitting: true });
    expect(screen.queryByRole('button', { name: /Continue/ })).toBeNull();
  });

  it('a refused submit keeps the card actionable and toasts', () => {
    mockSubmit.mockReturnValue(false);
    renderCall();
    fireEvent.click(screen.getByRole('radio', { name: /Отчёт/ }));
    act(() => {
      jest.advanceTimersByTime(320);
    });
    fireEvent.click(screen.getByRole('radio', { name: /Месяц/ }));
    const continueBtn = screen.getByRole('button', { name: /Continue/ });
    fireEvent.click(continueBtn);
    expect(mockShowToast).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Continue/ })).toBeInTheDocument();
    mockSubmit.mockReturnValue(undefined);
    fireEvent.click(continueBtn);
    expect(mockSubmit).toHaveBeenCalledTimes(2);
  });

  it('renders a STATIC card outside ChatContext — the share page must not crash (review К4)', () => {
    render(
      <MessageContext.Provider value={{ messageId: 'm1', isExpanded: true }}>
        <AskUserCall args={ARGS} />
      </MessageContext.Provider>,
    );
    expect(screen.getByText('Какой формат?')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Continue/ })).toBeNull();
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('renders nothing while the args are still streaming', () => {
    const { container } = renderCall({}, '{"questions":[{"prom');
    expect(container).toBeEmptyDOMElement();
  });
});
