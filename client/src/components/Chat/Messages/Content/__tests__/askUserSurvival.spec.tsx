import { RecoilRoot } from 'recoil';
import { ContentTypes, ASK_USER_TOOL } from 'librechat-data-provider';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { TMessageContentParts } from 'librechat-data-provider';
import { ChatContext } from '~/Providers/ChatContext';
import ContentParts from '../ContentParts';

/**
 * The owner's report (r26): «пока генерируется ответ под панелью выбора и я
 * выбираю ответы — когда ответ сгенерировался, карточка сбрасывается и я
 * впустую всё заполнил.»
 *
 * The ContentParts survival map has a guard already, but it was written
 * against a MOCKED Part. This drives the REAL chain — ContentParts → Part →
 * AskUserCall → ApprovalCard — through the exact prod transition: the model
 * streams a tool call, the user answers while the closing sentence is still
 * arriving, and finalization swaps the provisional message id for the server
 * one AND appends the text part.
 */

const mockSubmit = jest.fn();
jest.mock('~/hooks/Messages/useSubmitMessage', () => ({
  __esModule: true,
  default: () => ({ submitMessage: mockSubmit }),
}));

const askUserPart = (): TMessageContentParts =>
  ({
    type: ContentTypes.TOOL_CALL,
    [ContentTypes.TOOL_CALL]: {
      id: 'call-ask-1',
      name: ASK_USER_TOOL,
      args: JSON.stringify({
        questions: [
          { id: 'q1', prompt: 'Какой формат?', options: ['Сводка', 'Отчёт'] },
          { id: 'q2', prompt: 'Период?', options: ['Месяц', 'Год'] },
        ],
      }),
    },
  }) as unknown as TMessageContentParts;

const textPart = (value: string): TMessageContentParts =>
  ({ type: ContentTypes.TEXT, text: value }) as unknown as TMessageContentParts;

const view = (props: {
  messageId: string;
  isSubmitting: boolean;
  content: TMessageContentParts[];
}) => (
  <RecoilRoot>
    <ChatContext.Provider value={{} as never}>
      <ContentParts
        messageId={props.messageId}
        content={props.content}
        isSubmitting={props.isSubmitting}
        isLatestMessage={true}
        isCreatedByUser={false}
        isLast={true}
      />
    </ChatContext.Provider>
  </RecoilRoot>
);

describe('ask_user answers survive the finalization (owner r26)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockSubmit.mockReset().mockReturnValue(undefined);
  });
  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('keeps both answers when the id swaps AND the closing text part arrives', () => {
    const { rerender } = render(
      view({ messageId: 'user-1_', isSubmitting: true, content: [askUserPart()] }),
    );

    fireEvent.click(screen.getByRole('radio', { name: /Отчёт/ }));
    act(() => {
      jest.advanceTimersByTime(400);
    });
    fireEvent.click(screen.getByRole('radio', { name: /Месяц/ }));
    expect(screen.getByRole('radio', { name: /Месяц/ })).toHaveAttribute('aria-checked', 'true');

    /* Finalization, exactly as prod does it: provisional id → server id, the
     * stream flag drops, and the model's closing sentence lands as a second
     * part in the same message. */
    rerender(
      view({
        messageId: 'server-1',
        isSubmitting: false,
        content: [askUserPart(), textPart('Жду ваших ответов.')],
      }),
    );

    expect(screen.getByRole('radio', { name: /Отчёт/ })).toHaveAttribute('aria-checked', 'true');
    const pagerBack = screen.getByRole('button', { name: /previous question|Предыдущий/i });
    fireEvent.click(pagerBack);
    expect(screen.getByRole('radio', { name: /Отчёт/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('keeps the answers when the part INDEX shifts across finalization', () => {
    /* The streaming message carries an empty text placeholder some endpoints
     * seed, so the card sits at index 1; the persisted message has no such
     * part and the card lands at index 0. A map keyed by index misses. */
    const { rerender } = render(
      view({
        messageId: 'user-2_',
        isSubmitting: true,
        content: [textPart(''), askUserPart()],
      }),
    );

    fireEvent.click(screen.getByRole('radio', { name: /Отчёт/ }));
    act(() => {
      jest.advanceTimersByTime(400);
    });
    fireEvent.click(screen.getByRole('radio', { name: /Год/ }));

    rerender(
      view({
        messageId: 'server-3',
        isSubmitting: false,
        content: [askUserPart(), textPart('Жду ваших ответов.')],
      }),
    );

    /* The remount resets the carousel to question 1, so both answers are
     * checked where they live: «Отчёт» here, «Год» one page on. */
    expect(screen.getByRole('radio', { name: /Отчёт/ })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('button', { name: /next question|Следующий/i }));
    expect(screen.getByRole('radio', { name: /Год/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('the closing sentence under the card is not drawn at all', () => {
    render(
      view({
        messageId: 'server-2',
        isSubmitting: false,
        content: [askUserPart(), textPart('Уточнил вопросы — жду ваших ответов.')],
      }),
    );
    expect(screen.queryByText(/жду ваших ответов/i)).toBeNull();
  });
});
