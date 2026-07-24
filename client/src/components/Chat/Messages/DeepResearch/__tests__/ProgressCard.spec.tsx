import { render } from '@testing-library/react';
import type { TDeepResearchProgress } from '~/store';
import ProgressCard from '../ProgressCard';

jest.mock('~/Providers', () => ({
  useChatContext: () => ({ stopGenerating: jest.fn() }),
}));
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));
jest.mock('~/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));
jest.mock('~/store', () => ({}));
jest.mock('@librechat/client', () => ({
  Progress: ({ value }: { value: number }) => <div data-testid="progress" data-value={value} />,
}));
jest.mock('lucide-react', () => ({
  Check: () => <svg data-testid="icon-check" />,
  Square: () => <svg data-testid="icon-square" />,
  Loader2: () => <svg data-testid="icon-loader" />,
  WifiOff: () => <svg data-testid="icon-wifi" />,
}));

const snapshot = (over: Partial<TDeepResearchProgress>): TDeepResearchProgress => ({
  phase: 'research',
  steps: [],
  action: 'Исследует источники',
  searches: 1,
  progress: 0.5,
  ...over,
});

describe('ProgressCard', () => {
  it('renders the approved plan steps when present', () => {
    const { getByText, queryByText } = render(
      <ProgressCard data={snapshot({ steps: ['Собрать', 'Сравнить'] })} />,
    );
    expect(getByText('Собрать')).toBeInTheDocument();
    expect(getByText('Сравнить')).toBeInTheDocument();
    expect(queryByText('com_ui_deep_research_phase_scope')).not.toBeInTheDocument();
  });

  it('falls back to the three research phases when a run has no plan', () => {
    const { getByText, getAllByTestId } = render(
      <ProgressCard data={snapshot({ steps: [], phase: 'research' })} />,
    );
    expect(getByText('com_ui_deep_research_phase_scope')).toBeInTheDocument();
    expect(getByText('com_ui_deep_research_phase_research')).toBeInTheDocument();
    expect(getByText('com_ui_deep_research_phase_report')).toBeInTheDocument();
    // phase='research' → scope done (check), research active (spinner) — driven by `phase`,
    // not the 0.5 fraction (which would place the active mark differently).
    expect(getAllByTestId('icon-check')).toHaveLength(1);
    expect(getAllByTestId('icon-loader')).toHaveLength(1);
  });
});
