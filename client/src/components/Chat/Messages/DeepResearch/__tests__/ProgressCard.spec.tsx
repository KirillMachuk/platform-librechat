import { render, screen } from '@testing-library/react';
import type { TDeepResearchProgress } from '~/store';
import ProgressCard from '../ProgressCard';

/**
 * r25 package Б: the running card renders through the SAME vendored frame as
 * the plan card the user approved — so these guards drive the REAL
 * ApprovalCard (only the chat context and the tooltip wrapper are stubbed).
 * What they pin: the plan's steps carry live statuses, the step being worked
 * on is never hidden behind «Ещё N», Stop lives in the header, and the
 * offline state replaces the action line instead of pulsing on.
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

describe('ProgressCard (r25: the plan card frame, running)', () => {
  it('renders the approved plan steps when present', () => {
    render(<ProgressCard data={snapshot({ steps: ['Собрать', 'Сравнить'] })} />);
    expect(screen.getByText('Собрать')).toBeInTheDocument();
    expect(screen.getByText('Сравнить')).toBeInTheDocument();
    expect(screen.queryByText('com_ui_deep_research_phase_scope')).not.toBeInTheDocument();
  });

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

  it('shimmers the label of the step being worked on', () => {
    render(<ProgressCard data={snapshot({ steps: ['Собрать', 'Сравнить'], progress: 0.5 })} />);
    expect(screen.getByText('Сравнить').className).toContain('thinking-shimmer-active');
    expect(screen.getByText('Собрать').className).not.toContain('thinking-shimmer-active');
  });

  it('never hides the running step behind «Ещё N» (preview is 3)', () => {
    /* The collapsed well keeps its rows in the DOM (grid-rows collapse), so
     * `toBeVisible()` cannot see the difference in jsdom — a mutation proved
     * that assertion green with auto-expand removed. The honest observable is
     * the well's own state: the collapsed class is gone and the toggle
     * announces itself open. */
    const { container } = render(
      <ProgressCard
        data={snapshot({
          steps: ['Шаг 1', 'Шаг 2', 'Шаг 3', 'Шаг 4', 'Шаг 5'],
          progress: 0.9,
        })}
      />,
    );
    expect(rowOf('Шаг 5')).toHaveAttribute('data-status', 'active');
    expect(container.querySelector('.todoCollapsed')).toBeNull();
    expect(screen.getByRole('button', { name: /com_ui_cards_more/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('keeps the well collapsed while every hidden step is still ahead', () => {
    /* The control for the guard above: without it, a test that only ever sees
     * an expanded well proves nothing about the auto-expand rule. */
    const { container } = render(
      <ProgressCard
        data={snapshot({
          steps: ['Шаг 1', 'Шаг 2', 'Шаг 3', 'Шаг 4', 'Шаг 5'],
          progress: 0,
        })}
      />,
    );
    expect(rowOf('Шаг 1')).toHaveAttribute('data-status', 'active');
    expect(container.querySelector('.todoCollapsed')).not.toBeNull();
    expect(screen.getByRole('button', { name: /com_ui_cards_more/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('puts Stop in the header and reports progress to assistive tech', () => {
    render(<ProgressCard data={snapshot({ steps: ['Собрать'], progress: 0.42 })} />);
    expect(screen.getByTestId('dr-stop')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');
  });

  it('offline: the network notice replaces the action line, nothing pulses', () => {
    render(<ProgressCard data={snapshot({ steps: ['Собрать'], stalled: true })} />);
    expect(screen.getByRole('status')).toHaveTextContent('com_ui_deep_research_offline');
    expect(screen.queryByText('Исследует источники')).not.toBeInTheDocument();
  });
});
