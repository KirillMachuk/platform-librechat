import { buildAskAnswersMessage } from 'librechat-data-provider';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { MessagesViewContextValue } from '~/Providers/MessagesViewContext';
import { MessagesViewContext } from '~/Providers/MessagesViewContext';
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

  describe('an answered card still SHOWS what was answered (r25 acceptance)', () => {
    /* The regression this fixes: folding mounted a fresh card, so the chosen
     * option lost its mark, «Другое…» came back empty, and a screen reader
     * announced every option as not-checked. */
    const QUESTIONS = [
      { id: 'q1', prompt: 'Какой формат?', options: ['Сводка', 'Отчёт'] },
      { id: 'q2', prompt: 'Период?', options: ['Месяц', 'Год'] },
    ];

    const withAnswerMessage = (answers: Record<string, string>) => {
      const text = buildAskAnswersMessage(QUESTIONS, answers);
      const messages = [
        { messageId: 'answer-1', parentMessageId: 'm1', isCreatedByUser: true, text },
      ];
      return {
        getMessages: () => messages,
      } as unknown as MessagesViewContextValue;
    };

    const renderFolded = (
      ctx: MessagesViewContextValue | undefined,
      extras: { askAnswersInitial?: Record<string, string> } = {},
    ) => {
      const tree = (
        <MessageContext.Provider
          value={{
            messageId: 'm1',
            isExpanded: true,
            isSubmitting: false,
            isLatestMessage: false,
            askAnswersInitial: extras.askAnswersInitial,
          }}
        >
          <AskUserCall args={ARGS} />
        </MessageContext.Provider>
      );
      return render(
        ctx ? (
          <MessagesViewContext.Provider value={ctx}>{tree}</MessagesViewContext.Provider>
        ) : (
          tree
        ),
      );
    };

    it('restores the chosen option from the answers MESSAGE (survives a reload)', () => {
      renderFolded(withAnswerMessage({ q1: 'Отчёт', q2: 'Месяц' }));
      fireEvent.click(screen.getByRole('button', { expanded: false }));
      expect(screen.getByRole('radio', { name: /Отчёт/ })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('radio', { name: /Сводка/ })).toHaveAttribute(
        'aria-checked',
        'false',
      );
    });

    it('restores a free-text answer into «Другое…» instead of an empty field', () => {
      renderFolded(withAnswerMessage({ q1: 'Свой вариант ответа', q2: 'Месяц' }));
      fireEvent.click(screen.getByRole('button', { expanded: false }));
      expect(screen.getByDisplayValue('Свой вариант ответа')).toBeInTheDocument();
    });

    it('falls back to the in-session draft when no answers message is around', () => {
      renderFolded(undefined, { askAnswersInitial: { q1: 'Отчёт', q2: 'Год' } });
      fireEvent.click(screen.getByRole('button', { expanded: false }));
      expect(screen.getByRole('radio', { name: /Отчёт/ })).toHaveAttribute('aria-checked', 'true');
    });

    it('ignores an answers message that belongs to a DIFFERENT card', () => {
      /* getMessages() is the whole conversation, branches included, and `.find`
       * takes the first hit — the provenance checks are the only thing keeping
       * a neighbour's answers off this card (r25c review: both survived
       * mutation until this fixture existed). */
      const foreign = buildAskAnswersMessage(QUESTIONS, { q1: 'Сводка', q2: 'Год' });
      const ctx = {
        getMessages: () => [
          { messageId: 'x1', parentMessageId: 'OTHER-CARD', isCreatedByUser: true, text: foreign },
          { messageId: 'x2', parentMessageId: 'm1', isCreatedByUser: false, text: foreign },
        ],
      } as unknown as MessagesViewContextValue;
      renderFolded(ctx, { askAnswersInitial: { q1: 'Отчёт', q2: 'Месяц' } });
      fireEvent.click(screen.getByRole('button', { expanded: false }));
      /* Neither foreign message may win: the draft is what shows. */
      expect(screen.getByRole('radio', { name: /Отчёт/ })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('radio', { name: /Сводка/ })).toHaveAttribute(
        'aria-checked',
        'false',
      );
    });

    it('survives a « — » inside the question text (matched by prompt, not by order)', () => {
      /* «Формат отчёта — краткий или подробный?» is ordinary Russian, and the
       * summary separator is the same dash: a positional parse put half the
       * question into «Другое…» and left every option unchecked. */
      const tricky = [
        { id: 'q1', prompt: 'Формат — краткий или подробный?', options: ['Сводка', 'Отчёт'] },
        { id: 'q2', prompt: 'Период?', options: ['Месяц', 'Год'] },
      ];
      const text = buildAskAnswersMessage(tricky, { q1: 'Отчёт', q2: 'Месяц' });
      const ctx = {
        getMessages: () => [
          { messageId: 'a1', parentMessageId: 'm1', isCreatedByUser: true, text },
        ],
      } as unknown as MessagesViewContextValue;
      render(
        <MessagesViewContext.Provider value={ctx}>
          <MessageContext.Provider
            value={{
              messageId: 'm1',
              isExpanded: true,
              isSubmitting: false,
              isLatestMessage: false,
            }}
          >
            <AskUserCall args={JSON.stringify({ questions: tricky })} />
          </MessageContext.Provider>
        </MessagesViewContext.Provider>,
      );
      fireEvent.click(screen.getByRole('button', { expanded: false }));
      expect(screen.getByRole('radio', { name: /Отчёт/ })).toHaveAttribute('aria-checked', 'true');
      expect(screen.queryByDisplayValue(/краткий или подробный/)).toBeNull();
    });

    it('a SKIPPED card shows nothing, not the abandoned draft', () => {
      /* «Пропустить» is reachable with options already clicked; the card used
       * to display that abandoned draft as an answer, directly above a chip
       * reading «Вопросы пропущены» (r25c review). */
      const ctx = {
        getMessages: () => [
          {
            messageId: 's1',
            parentMessageId: 'm1',
            isCreatedByUser: true,
            text: 'Пропустить вопросы',
          },
        ],
      } as unknown as MessagesViewContextValue;
      renderFolded(ctx, { askAnswersInitial: { q1: 'Отчёт', q2: 'Месяц' } });
      fireEvent.click(screen.getByRole('button', { expanded: false }));
      expect(screen.getByRole('radio', { name: /Отчёт/ })).toHaveAttribute('aria-checked', 'false');
      expect(screen.getByRole('radio', { name: /Сводка/ })).toHaveAttribute(
        'aria-checked',
        'false',
      );
    });

    it('keeps the pager so every answered question is reachable', () => {
      /* Without it the folded card exposed only question 1: the rest stayed
       * aria-hidden with no way to page to them (r25c review). */
      renderFolded(withAnswerMessage({ q1: 'Отчёт', q2: 'Месяц' }));
      fireEvent.click(screen.getByRole('button', { expanded: false }));
      const next = screen.getByRole('button', { name: /next question|Следующий вопрос/i });
      fireEvent.click(next);
      expect(screen.getByRole('radio', { name: /Месяц/ })).toHaveAttribute('aria-checked', 'true');
      expect(screen.queryByRole('button', { name: /Continue/ })).toBeNull();
    });
  });

  it('renders nothing while the args are still streaming', () => {
    const { container } = renderCall({}, '{"questions":[{"prom');
    expect(container).toBeEmptyDOMElement();
  });
});
