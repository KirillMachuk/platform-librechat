import { RecoilRoot } from 'recoil';
import { render, screen } from '@testing-library/react';
import type { TDeepResearchProgress } from '~/store/deepResearch';
import { drProgressByConvoId } from '~/store/deepResearch';
import RunningSlot from '../RunningSlot';

/**
 * Who draws a live run — the standalone card, or the plan card?
 *
 * Since r26 the approved plan card draws its own run, so this slot must step
 * aside for it; it stays for a PROCEED run, which has no plan card to grow
 * into. The snapshot's own `steps` tell the two apart. That decision removes
 * a card from the screen for a whole class of runs and was covered by
 * nothing — the slot is mocked away in every other suite (r26 review).
 */

jest.mock('~/Providers', () => ({
  useChatContext: () => ({ stopGenerating: jest.fn() }),
}));
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));
jest.mock('@librechat/client', () => ({
  TooltipAnchor: ({ render: r }: { render?: React.ReactElement }) => r ?? null,
}));

const CONVO = 'c1';

const withSnapshot = (snapshot: Partial<TDeepResearchProgress> | null) =>
  render(
    <RecoilRoot
      initializeState={({ set }) => {
        if (snapshot != null) {
          set(drProgressByConvoId(CONVO), snapshot as TDeepResearchProgress);
        }
      }}
    >
      <RunningSlot conversationId={CONVO} />
    </RecoilRoot>,
  );

const base = { phase: 'research', action: 'Ищет', searches: 1, progress: 0.5 };

describe('RunningSlot — the PROCEED-run card only (r26)', () => {
  it('draws the standalone card when the run has NO plan steps', () => {
    withSnapshot({ ...base, steps: [] });
    expect(screen.getByText('Ищет')).toBeInTheDocument();
    expect(screen.getByTestId('dr-stop')).toBeInTheDocument();
  });

  it('steps aside when the snapshot carries plan steps — the plan card owns that run', () => {
    const { container } = withSnapshot({ ...base, steps: ['Собрать', 'Сравнить'] });
    expect(container).toBeEmptyDOMElement();
  });

  it('draws nothing before the plan exists, and nothing without a run', () => {
    expect(withSnapshot({ ...base, steps: [], phase: 'prepare' }).container).toBeEmptyDOMElement();
    expect(withSnapshot({ ...base, steps: [], phase: 'plan' }).container).toBeEmptyDOMElement();
    expect(withSnapshot(null).container).toBeEmptyDOMElement();
  });
});
