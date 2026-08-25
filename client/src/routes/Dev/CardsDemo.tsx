/* eslint-disable i18next/no-literal-string -- dev-only acceptance page, deliberate Russian fixtures */
import { useEffect, useState } from 'react';
import type { ApprovalCardStrings } from '~/components/Chat/Cards/ApprovalCard';
import { ApprovalCard, ApprovalCardHeaderAction } from '~/components/Chat/Cards/ApprovalCard';

/**
 * Dev-only acceptance page for the interactive-cards track (К1): all
 * ApprovalCard variants side by side, live countdown, both themes via the
 * toggle button. Registered ONLY when import.meta.env.DEV (routes/index.tsx),
 * so production builds tree-shake the route away.
 */
export default function CardsDemo() {
  const [dark, setDark] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [secsLeft, setSecsLeft] = useState(30);
  const [countdownOn, setCountdownOn] = useState(true);

  useEffect(() => {
    const id = setInterval(() => setSecsLeft((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, []);

  const push = (line: string) => setLog((l) => [line, ...l].slice(0, 8));

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

  return (
    <div className={dark ? 'dark' : undefined}>
      <div
        className="min-h-screen p-8"
        style={{ background: 'var(--presentation)', color: 'var(--text-primary)' }}
      >
        <div className="mx-auto flex max-w-xl flex-col gap-8">
          <button
            type="button"
            className="self-start rounded-lg border border-border-light px-3 py-1 text-sm"
            onClick={() => setDark((d) => !d)}
          >
            Тема: {dark ? 'тёмная' : 'светлая'}
          </button>

          <ApprovalCard
            variant="questions"
            strings={strings}
            title="Вопросы"
            approveLabel="Продолжить"
            secondaryLabel="Пропустить"
            questions={[
              {
                id: 'q1',
                prompt: 'Какой формат отчёта подготовить?',
                options: ['Короткая сводка', 'Полный отчёт', 'Таблица сравнения'],
              },
              {
                id: 'q2',
                prompt: 'За какой период взять данные?',
                options: ['Месяц', 'Квартал', 'Год'],
              },
              {
                id: 'q3',
                prompt: 'Нужны ли источники?',
                options: ['Да, со ссылками', 'Нет'],
              },
            ]}
            onApprove={(p) => push(`Вопросы → ${JSON.stringify(p?.answers)}`)}
            onSecondary={() => push('Вопросы → пропущено')}
          />

          <ApprovalCard
            variant="plan"
            strings={strings}
            title="Глубокое исследование"
            planTitle="Рынок доставки для быстрого питания"
            todoTitle="Шаги"
            plan={[
              { id: '1', title: 'Собрать предложения крупнейших агрегаторов' },
              { id: '2', title: 'Сравнить комиссии и условия 2025–2026' },
              { id: '3', title: 'Выделить тренды по регионам' },
              { id: '4', title: 'Сопоставить с российскими условиями' },
              { id: '5', title: 'Сформировать таблицу и рекомендацию' },
            ]}
            approveLabel="Начать"
            secondaryLabel="Редактировать"
            headerAction={
              <ApprovalCardHeaderAction label="Отменить" onClick={() => push('План → отмена')} />
            }
            autoApprove={countdownOn && secsLeft > 0 ? { secsLeft, total: 30 } : null}
            onAutoApproveCancel={() => {
              setCountdownOn(false);
              push('План → автозапуск отменён');
            }}
            onApprove={() => push('План → старт')}
            onSecondary={() => push('План → редактировать')}
          />

          <ApprovalCard
            variant="command"
            strings={strings}
            title="Выполнить команду?"
            approveLabel="Выполнить"
            secondaryLabel="Пропустить"
            command={'pip install pandas\npython analyze.py --input data.csv'}
            cwd="~/sandbox"
            onApprove={() => push('Команда → выполнить')}
            onSecondary={() => push('Команда → пропуск')}
          />

          <pre className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            {log.join('\n')}
          </pre>
        </div>
      </div>
    </div>
  );
}
