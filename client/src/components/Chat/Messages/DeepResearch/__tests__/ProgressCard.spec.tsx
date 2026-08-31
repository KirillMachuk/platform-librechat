import { render, screen, fireEvent } from '@testing-library/react';
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
  it('falls back to the three research phases when a run has no plan', () => {
    render(<ProgressCard data={snapshot({ steps: [], phase: 'research' })} />);
    expect(screen.getByText('com_ui_deep_research_phase_scope')).toBeInTheDocument();
    expect(screen.getByText('com_ui_deep_research_phase_research')).toBeInTheDocument();
    expect(screen.getByText('com_ui_deep_research_phase_report')).toBeInTheDocument();
    /* phase='research' → scope done, research active — driven by `phase`, not
     * the 0.5 fraction (which would place the active mark differently). */
    expect(rowOf('com_ui_deep_research_phase_scope')).toHaveAttribute('data-status', 'done');
    expect(rowOf('com_ui_deep_research_phase_research')).toHaveAttribute('data-status', 'active');
    expect(rowOf('com_ui_deep_research_phase_report')).toHaveAttribute('data-status', 'pending');
    // The active phase is marked for assistive tech (VoiceOver reads it as the current step).
    expect(rowOf('com_ui_deep_research_phase_research')).toHaveAttribute('aria-current', 'step');
    expect(rowOf('com_ui_deep_research_phase_scope')).not.toHaveAttribute('aria-current');
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
