import { render, screen, fireEvent, act } from '@testing-library/react';
import type { ApprovalCardStrings } from '../ApprovalCard';
import { ApprovalCard } from '../ApprovalCard';

const strings: ApprovalCardStrings = {
  otherPlaceholder: 'Другое…',
  moreLabel: (n) => `Ещё ${n}`,
  lessLabel: 'Свернуть',
  autoApproveBefore: 'Автозапуск через ',
  autoApproveAfter: ' с',
  autoApproveCancelTip: 'Отмена',
  prevQuestion: 'Предыдущий вопрос',
  nextQuestion: 'Следующий вопрос',
  cancelAutoApprove: 'Отменить автозапуск',
  questionOf: (c, t) => `Вопрос ${c} из ${t}`,
  customAnswerFor: (p) => `Свой ответ: ${p}`,
};

const QUESTIONS = [
  { id: 'q1', prompt: 'Какой подход?', options: ['Первый', 'Второй'] },
  { id: 'q2', prompt: 'Где хранить?', options: ['Тут', 'Там'] },
];

const PLAN = [
  { id: 'p1', title: 'Шаг один' },
  { id: 'p2', title: 'Шаг два' },
  { id: 'p3', title: 'Шаг три' },
  { id: 'p4', title: 'Шаг четыре' },
  { id: 'p5', title: 'Шаг пять' },
];

describe('ApprovalCard — questions variant', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  const renderQuestions = (onApprove = jest.fn(), onSecondary = jest.fn()) => {
    render(
      <ApprovalCard
        variant="questions"
        strings={strings}
        title="Вопросы"
        approveLabel="Продолжить"
        secondaryLabel="Пропустить"
        questions={QUESTIONS}
        onApprove={onApprove}
        onSecondary={onSecondary}
      />,
    );
    return { onApprove, onSecondary };
  };

  it('records an option click and auto-advances to the next question after 320ms', () => {
    renderQuestions();
    expect(screen.getByLabelText('Вопрос 1 из 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Первый/ }));
    expect(screen.getByRole('radio', { name: /Первый/ })).toHaveAttribute('aria-checked', 'true');
    act(() => {
      jest.advanceTimersByTime(320);
    });
    expect(screen.getByLabelText('Вопрос 2 из 2')).toBeInTheDocument();
  });

  it('keeps Continue disabled until every question has an answer, then reports all answers', () => {
    const { onApprove } = renderQuestions();
    const continueBtn = screen.getByRole('button', { name: /Продолжить/ });
    expect(continueBtn).toBeDisabled();

    fireEvent.click(screen.getByRole('radio', { name: /Первый/ }));
    act(() => {
      jest.advanceTimersByTime(320);
    });
    expect(continueBtn).toBeDisabled();

    fireEvent.click(screen.getByRole('radio', { name: /Там/ }));
    expect(continueBtn).toBeEnabled();
    fireEvent.click(continueBtn);
    expect(onApprove).toHaveBeenCalledWith({ answers: { q1: 'Первый', q2: 'Там' } });
  });

  it('commits a custom «Другое» answer with Enter and approves on the last question', () => {
    const { onApprove } = renderQuestions();
    fireEvent.click(screen.getByRole('radio', { name: /Первый/ }));
    act(() => {
      jest.advanceTimersByTime(320);
    });
    const custom = screen.getByLabelText('Свой ответ: Где хранить?');
    fireEvent.click(custom);
    fireEvent.change(custom, { target: { value: 'В сейфе' } });
    fireEvent.keyDown(custom, { key: 'Enter' });
    expect(onApprove).toHaveBeenCalledWith({ answers: { q1: 'Первый', q2: 'В сейфе' } });
  });

  it('Enter in «Другое…» ADVANCES when the question is not the last one', () => {
    /* r25 acceptance (business-os-83): «Enter в Другое… не перелистывает».
     * The last-question path is covered above; this is the non-last path. */
    render(
      <ApprovalCard
        variant="questions"
        strings={strings}
        title="Вопросы"
        approveLabel="Продолжить"
        questions={[
          { id: 'q1', prompt: 'Объём работ?', options: ['Косметика', 'Капитальный'] },
          { id: 'q2', prompt: 'Бюджет?', options: ['До 5', 'Больше'] },
          { id: 'q3', prompt: 'Сроки?', options: ['Месяц', 'Квартал'] },
        ]}
        onApprove={jest.fn()}
      />,
    );
    expect(screen.getByLabelText('Вопрос 1 из 3')).toBeInTheDocument();
    const custom = screen.getByLabelText('Свой ответ: Объём работ?');
    fireEvent.click(custom);
    fireEvent.change(custom, { target: { value: 'Только переговорная и кухня' } });
    fireEvent.keyDown(custom, { key: 'Enter' });
    act(() => {
      jest.advanceTimersByTime(400);
    });
    expect(screen.getByLabelText('Вопрос 2 из 3')).toBeInTheDocument();
  });

  it('Enter on a focused radio activates nothing card-wide (no stale submit) — xhigh review', () => {
    const { onApprove } = renderQuestions();
    fireEvent.click(screen.getByRole('radio', { name: /Первый/ }));
    act(() => {
      jest.advanceTimersByTime(320);
    });
    fireEvent.click(screen.getByRole('radio', { name: /Там/ }));
    // all answered, last question: Enter while focus sits on a RADIO must not approve
    const radio = screen.getByRole('radio', { name: /Тут/ });
    fireEvent.keyDown(radio, { key: 'Enter', bubbles: true });
    expect(onApprove).not.toHaveBeenCalled();
  });

  it('marks the card static for CSS when showActions=false', () => {
    render(
      <ApprovalCard
        variant="questions"
        strings={strings}
        title="Вопросы"
        approveLabel="Продолжить"
        questions={QUESTIONS}
        showActions={false}
      />,
    );
    expect(screen.getByTestId('approval-card')).toHaveAttribute('data-static', 'true');
  });

  it('the secondary button reports without answers', () => {
    const { onSecondary } = renderQuestions();
    fireEvent.click(screen.getByRole('button', { name: 'Пропустить' }));
    expect(onSecondary).toHaveBeenCalled();
  });
});

describe('ApprovalCard — the questions group behaves like a radio group (r25 acceptance)', () => {
  /* It was ANNOUNCED as one (role=radiogroup) but behaved like a button list:
   * every option was a tab stop and the arrows did nothing. */
  const renderQ = () =>
    render(
      <ApprovalCard
        variant="questions"
        strings={strings}
        title="Вопросы"
        approveLabel="Продолжить"
        questions={QUESTIONS}
        onApprove={jest.fn()}
      />,
    );

  it('carries ONE tab stop, on the first option when nothing is chosen', () => {
    renderQ();
    const radios = screen.getAllByRole('radio', { hidden: true }).filter((r) => r.textContent);
    const visible = radios.filter((r) => r.closest('[data-active="true"]') != null);
    expect(visible.map((r) => r.getAttribute('tabindex'))).toEqual(['0', '-1']);
  });

  it('moves the tab stop onto the chosen option', () => {
    renderQ();
    fireEvent.click(screen.getByRole('radio', { name: /Второй/ }));
    const chosen = screen.getByRole('radio', { name: /Второй/ });
    expect(chosen).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: /Первый/ })).toHaveAttribute('tabindex', '-1');
  });

  it('ArrowDown/ArrowUp move the focus inside the group and reach «Другое…»', () => {
    renderQ();
    const first = screen.getByRole('radio', { name: /Первый/ });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(screen.getByRole('radio', { name: /Второй/ })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('radio', { name: /Второй/ }), { key: 'ArrowDown' });
    expect(screen.getByLabelText('Свой ответ: Какой подход?')).toHaveFocus();

    const second = screen.getByRole('radio', { name: /Второй/ });
    second.focus();
    fireEvent.keyDown(second, { key: 'ArrowUp' });
    expect(screen.getByRole('radio', { name: /Первый/ })).toHaveFocus();
  });

  it('an arrow key does not escape the card (stopPropagation, not just a no-op)', () => {
    /* The previous version asserted that onApprove was not called, which was
     * true with or without stopPropagation — the mutation survived (r25c
     * review). This watches the event itself leave the card. */
    const onOuterKeyDown = jest.fn();
    render(
      <div onKeyDown={onOuterKeyDown}>
        <ApprovalCard
          variant="questions"
          strings={strings}
          title="Вопросы"
          approveLabel="Продолжить"
          questions={QUESTIONS}
          onApprove={jest.fn()}
        />
      </div>,
    );
    const first = screen.getByRole('radio', { name: /Первый/ });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(onOuterKeyDown).not.toHaveBeenCalled();
  });
});

describe('ApprovalCard — actionsArmed (r25: select now, commit when the turn ends)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  const renderUnarmed = (onApprove = jest.fn(), onSecondary = jest.fn()) => {
    render(
      <ApprovalCard
        variant="questions"
        strings={strings}
        title="Вопросы"
        approveLabel="Продолжить"
        secondaryLabel="Пропустить"
        questions={QUESTIONS}
        actionsArmed={false}
        onApprove={onApprove}
        onSecondary={onSecondary}
      />,
    );
    return { onApprove, onSecondary };
  };

  const answerAll = () => {
    fireEvent.click(screen.getByRole('radio', { name: /Первый/ }));
    act(() => {
      jest.advanceTimersByTime(320);
    });
    fireEvent.click(screen.getByRole('radio', { name: /Тут/ }));
  };

  it('options stay LIVE while unarmed — no data-static inertness', () => {
    const { onApprove } = renderUnarmed();
    expect(document.querySelector('[data-static]')).toBeNull();
    answerAll();
    expect(screen.getByRole('radio', { name: /Тут/ })).toHaveAttribute('aria-checked', 'true');
    expect(onApprove).not.toHaveBeenCalled();
  });

  it('both buttons are disabled and the card-level Enter does not approve', () => {
    const { onApprove, onSecondary } = renderUnarmed();
    answerAll();
    expect(screen.getByRole('button', { name: /Продолжить/ })).toBeDisabled();
    const skip = screen.getByRole('button', { name: 'Пропустить' });
    expect(skip).toBeDisabled();
    fireEvent.click(skip);
    expect(onSecondary).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByText('Вопросы').closest('div') as HTMLElement, {
      key: 'Enter',
    });
    expect(onApprove).not.toHaveBeenCalled();
  });

  it('Enter in «Другое…» on the last question records the answer but does not submit', () => {
    const { onApprove } = renderUnarmed();
    fireEvent.click(screen.getByRole('radio', { name: /Первый/ }));
    act(() => {
      jest.advanceTimersByTime(320);
    });
    const custom = screen.getByLabelText('Свой ответ: Где хранить?');
    fireEvent.click(custom);
    fireEvent.change(custom, { target: { value: 'Свой вариант' } });
    fireEvent.keyDown(custom, { key: 'Enter' });
    expect(onApprove).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('Свой вариант')).toBeInTheDocument();
  });

  it('initialAnswers seed the selections and report through onAnswersChange', () => {
    const onAnswersChange = jest.fn();
    render(
      <ApprovalCard
        variant="questions"
        strings={strings}
        title="Вопросы"
        approveLabel="Продолжить"
        questions={QUESTIONS}
        initialAnswers={{ q1: 'Первый', q2: 'Свой ответ мимо вариантов' }}
        onAnswersChange={onAnswersChange}
      />,
    );
    expect(screen.getByRole('radio', { name: /Первый/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByDisplayValue('Свой ответ мимо вариантов')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Продолжить/ })).toBeEnabled();
    expect(onAnswersChange).toHaveBeenCalledWith({
      q1: 'Первый',
      q2: 'Свой ответ мимо вариантов',
    });
  });
});

describe('ApprovalCard — plan variant', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  const renderPlan = (props: Partial<React.ComponentProps<typeof ApprovalCard>> = {}) => {
    const onApprove = jest.fn();
    const view = render(
      <ApprovalCard
        variant="plan"
        strings={strings}
        title="Задачи"
        todoTitle="Задачи"
        approveLabel="Начать"
        secondaryLabel="Редактировать"
        planTitle="План исследования"
        plan={PLAN}
        onApprove={onApprove}
        {...props}
      />,
    );
    return { onApprove, view };
  };

  it('shows the preview and unfolds the rest behind the «ещё» toggle', () => {
    renderPlan();
    expect(screen.getByText('Шаг один')).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: /Ещё 2/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Свернуть' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('draws the controlled pie and reports the ✕ to the parent (the card never ticks itself)', () => {
    const onCancel = jest.fn();
    const { onApprove } = renderPlan({
      autoApprove: { secsLeft: 5, total: 30 },
      onAutoApproveCancel: onCancel,
    });
    expect(screen.getByTestId('auto-approve')).toBeInTheDocument();
    act(() => {
      jest.advanceTimersByTime(10000);
    });
    // the parent owns the clock: nothing fires from inside the card
    expect(onApprove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Отменить автозапуск' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('fades the pie out when the parent drops the countdown', () => {
    const onApprove = jest.fn();
    const base = {
      variant: 'plan' as const,
      strings,
      title: 'Задачи',
      todoTitle: 'Задачи',
      approveLabel: 'Начать',
      plan: PLAN,
      onApprove,
    };
    const { rerender } = render(
      <ApprovalCard {...base} autoApprove={{ secsLeft: 5, total: 30 }} />,
    );
    expect(screen.getByTestId('auto-approve')).toBeInTheDocument();
    rerender(<ApprovalCard {...base} autoApprove={null} />);
    act(() => {
      jest.advanceTimersByTime(280);
    });
    expect(screen.queryByTestId('auto-approve')).toBeNull();
  });

  it('renders no countdown at all without autoApprove (config switch off)', () => {
    renderPlan();
    expect(screen.queryByTestId('auto-approve')).toBeNull();
  });
});
