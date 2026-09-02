import { consumePlanArrivedLive, markPlanArrivedLive, planArrivedLive } from '../deepResearch';

/**
 * The live-arrival mark is what keeps «run immediately» from launching a plan nobody asked
 * for today: only a plan whose final this tab processed carries it, and it is spent by the
 * first decision made about it.
 */
describe('plans that arrived live (r30)', () => {
  it('a plan nobody marked is not live — a plan mounted from history never self-starts', () => {
    expect(planArrivedLive('history-plan')).toBe(false);
    expect(consumePlanArrivedLive('history-plan')).toBe(false);
  });

  it('a marked plan reads as live until it is spent, and spends exactly once', () => {
    markPlanArrivedLive('live-plan');
    expect(planArrivedLive('live-plan')).toBe(true);
    expect(planArrivedLive('live-plan')).toBe(true);
    expect(consumePlanArrivedLive('live-plan')).toBe(true);
    expect(planArrivedLive('live-plan')).toBe(false);
    /* The second caller — a remount, a re-run effect, a later flip of the setting — gets
     * nothing: one arrival permits one decision. */
    expect(consumePlanArrivedLive('live-plan')).toBe(false);
  });
});
