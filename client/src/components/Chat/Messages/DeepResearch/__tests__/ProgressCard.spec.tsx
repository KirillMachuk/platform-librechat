import { render, screen } from '@testing-library/react';
import type { TDeepResearchProgress } from '~/store';
import ProgressCard from '../ProgressCard';

/**
 * Since r26 this standalone card serves ONE case: a PROCEED run, which has no
 * plan card to grow into. A run WITH a plan is drawn by the plan card itself
 * (PlanCard.spec covers that), and RunningSlot steps aside for it — so the
 * guards here are about the three research phases, the Stop control and the
 * offline freeze. They drive the REAL ApprovalCard; only the chat context and
 * the tooltip wrapper are stubbed.
 */

jest.mock('~/Providers', () => ({
  useChatContext: () => ({ stopGenerating: jest.fn() }),
}));
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));
jest.mock('~/store', () => ({}));
jest.mock('@librechat/client', () => ({
  /* Пропускает свой render насквозь: подсказка — это ПЛАШКА над контролом,
     сам контрол она не подменяет (канон §6.6). */
  TooltipAnchor: ({ render }: { description?: React.ReactNode; render?: React.ReactElement }) =>
    render ?? null,
}));

const snapshot = (over: Partial<TDeepResearchProgress>): TDeepResearchProgress => ({
  phase: 'research',
  steps: [],
  action: 'Исследует источники',
  searches: 1,
  progress: 0.5,
  ...over,
});

const rowOf = (text: string) => screen.getByText(text).closest('li');

describe('ProgressCard — the PROCEED run card (r26)', () => {
  it('invents NO steps when a run has no plan — the well is not drawn at all', () => {
    /* It used to substitute three constants («Определение области
     * исследования» / «Исследование источников» / «Формирование отчёта») into
     * the same well, with the same «Шаги» heading and checkmarks a real plan
     * gets. The owner read them as HIS plan, and they fit any research — the
     * card was hiding an empty state behind invented content (r28). Since the
     * gate always produces a plan and a continuation inherits the approved one,
     * this card shows only what it knows: the action line and the bar. */
    const { container } = render(
      <ProgressCard data={snapshot({ steps: [], phase: 'research' })} />,
    );
    expect(screen.queryByText('com_ui_deep_research_phase_scope')).toBeNull();
    expect(screen.queryByText('com_ui_deep_research_phase_research')).toBeNull();
    expect(screen.queryByText('com_ui_deep_research_phase_report')).toBeNull();
    expect(screen.queryByText('com_ui_deep_research_steps')).toBeNull();
    expect(container.querySelector('li')).toBeNull();
    /* What it does know is still there. */
    expect(screen.getByText('Исследует источники')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('puts Stop in the header and reports progress to assistive tech', () => {
    render(<ProgressCard data={snapshot({ steps: ['Собрать'], progress: 0.42 })} />);
    expect(screen.getByTestId('dr-stop')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');
  });

  it('offline: the network notice replaces the action line, and NOTHING shimmers', () => {
    /* The card must not look busy while the run is parked (review r2). The
     * frame would have kept shimmering the active step — the test name
     * promised «nothing pulses» while only the action line was checked. */
    const { container } = render(
      <ProgressCard data={snapshot({ steps: ['Собрать', 'Сравнить'], stalled: true })} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('com_ui_deep_research_offline');
    expect(screen.queryByText('Исследует источники')).not.toBeInTheDocument();
    expect(container.querySelector('.thinking-shimmer-paint')).toBeNull();
    expect(container.querySelector('li[data-status="active"]')).toBeNull();
  });
});
