import type { TDeepResearchProgress } from '~/store/deepResearch';
import { runActiveIndex, runStatusSteps } from '../RunFooter';

/**
 * Which plan step a live research card highlights.
 *
 * The owner's report (r27): «внизу пишется, что исследует климатические нормы,
 * а в плане как будто уже перешло к типичным температурам». The two disagreed
 * because only one of them was real. `progress` is a curve over SUPERVISOR
 * ROUNDS — `0.1 + 0.75·r/(r+1.5)` — and the card multiplied it by the number of
 * plan steps: the very first research round reads 0.40, so a five-step plan
 * opened on step 3 with steps 1 and 2 already ticked. Nothing in that snapshot
 * knew where the run was. Now the run reports the step, and when it does not
 * report one the card marks nothing.
 */

const snap = (over: Partial<TDeepResearchProgress>): TDeepResearchProgress =>
  ({
    phase: 'research',
    steps: ['a', 'b', 'c', 'd', 'e'],
    action: 'Исследует',
    searches: 1,
    progress: 0.4,
    ...over,
  }) as TDeepResearchProgress;

describe('runActiveIndex — reported, never derived (r27)', () => {
  it('returns the step the run reported', () => {
    expect(runActiveIndex(snap({ stepIndex: 0 }), 5)).toBe(0);
    expect(runActiveIndex(snap({ stepIndex: 3 }), 5)).toBe(3);
  });

  it('FAILS ON PRE-FIX CODE: the first research round is step 1, not step 3', () => {
    /* progress 0.40 × 5 steps floored = 2 — the shipped defect, in one line. */
    expect(runActiveIndex(snap({ stepIndex: 0, progress: 0.4 }), 5)).toBe(0);
  });

  it('marks NOTHING when the run reported no step', () => {
    expect(runActiveIndex(snap({}), 5)).toBe(-1);
    expect(runActiveIndex(snap({ stepIndex: undefined }), 5)).toBe(-1);
  });

  it('ignores a value that is not a usable number', () => {
    expect(runActiveIndex(snap({ stepIndex: NaN }), 5)).toBe(-1);
    expect(runActiveIndex(snap({ stepIndex: Infinity }), 5)).toBe(-1);
  });

  it('clamps into the plan it is drawing — a stale index cannot point past it', () => {
    /* The plan card parses its steps from the message; the index comes from the
     * run. A re-planned turn can leave the two one render apart. */
    expect(runActiveIndex(snap({ stepIndex: 9 }), 5)).toBe(4);
    expect(runActiveIndex(snap({ stepIndex: -3 }), 5)).toBe(0);
  });

  it('has no step to point at when there are no steps', () => {
    expect(runActiveIndex(snap({ stepIndex: 0 }), 0)).toBe(-1);
  });
});

describe('runStatusSteps under an unreported step', () => {
  it('leaves every step at rest — no done, no active', () => {
    const steps = runStatusSteps(['a', 'b', 'c'], snap({}), -1);
    expect(steps.map((s) => s.status)).toEqual(['pending', 'pending', 'pending']);
  });

  it('marks everything before the reported step done, and that one active', () => {
    const steps = runStatusSteps(['a', 'b', 'c'], snap({ stepIndex: 1 }), 1);
    expect(steps.map((s) => s.status)).toEqual(['done', 'active', 'pending']);
  });

  it('a parked (offline) run has no active step even on a known index', () => {
    const steps = runStatusSteps(['a', 'b', 'c'], snap({ stepIndex: 1, stalled: true }), 1);
    expect(steps.map((s) => s.status)).toEqual(['done', 'pending', 'pending']);
  });
});
