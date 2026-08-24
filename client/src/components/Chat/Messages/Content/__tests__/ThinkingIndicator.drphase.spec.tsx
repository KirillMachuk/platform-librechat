import { RecoilRoot } from 'recoil';
import { render, screen } from '@testing-library/react';
import type { MutableSnapshot } from 'recoil';
import RunningSlot from '../../DeepResearch/RunningSlot';
import ThinkingIndicator from '../ThinkingIndicator';
import store from '~/store';

jest.mock('../../DeepResearch/ProgressCard', () => ({
  __esModule: true,
  default: () => <div data-testid="progress-card" />,
}));

const seed =
  (convoId: string, phase: string) =>
  ({ set }: MutableSnapshot) =>
    set(store.drProgressByConvoId(convoId), {
      phase,
      steps: [],
      action: '',
      searches: 0,
      progress: 0,
    });

describe('ThinkingIndicator — DR pre-plan phase labels (round 23)', () => {
  it('shows the generic label without any DR progress', () => {
    render(
      <RecoilRoot>
        <ThinkingIndicator conversationId="c1" />
      </RecoilRoot>,
    );
    expect(screen.getByText(/думаю…|thinking…/i)).toBeInTheDocument();
  });

  it('swaps to the plan-phase label during the plan decision', () => {
    render(
      <RecoilRoot initializeState={seed('c1', 'plan')}>
        <ThinkingIndicator conversationId="c1" />
      </RecoilRoot>,
    );
    expect(screen.getByText(/думаю над планом|thinking about the plan/i)).toBeInTheDocument();
  });

  it('keeps the generic label for graph phases (the card owns those)', () => {
    render(
      <RecoilRoot initializeState={seed('c1', 'research')}>
        <ThinkingIndicator conversationId="c1" />
      </RecoilRoot>,
    );
    expect(screen.getByText(/думаю…|thinking…/i)).toBeInTheDocument();
  });
});

describe('RunningSlot — pre-plan phases stay label-only (round 23)', () => {
  it('renders nothing for prepare/plan so only one waiting label is on screen', () => {
    const { container } = render(
      <RecoilRoot initializeState={seed('c1', 'prepare')}>
        <RunningSlot conversationId="c1" />
      </RecoilRoot>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('still renders the progress card for graph phases', () => {
    render(
      <RecoilRoot initializeState={seed('c1', 'research')}>
        <RunningSlot conversationId="c1" />
      </RecoilRoot>,
    );
    expect(screen.getByTestId('progress-card')).toBeInTheDocument();
  });
});
