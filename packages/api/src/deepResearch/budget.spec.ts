import { armDeepResearchBudget, sumUsageTokens } from './budget';

describe('sumUsageTokens', () => {
  it('sums prompt+completion tokens, preferring total_tokens when present', () => {
    expect(
      sumUsageTokens([
        { input_tokens: 10, output_tokens: 5 },
        { total_tokens: 100 },
        { input_tokens: 3 },
        {},
      ]),
    ).toBe(15 + 100 + 3);
  });

  it('handles empty / undefined input', () => {
    expect(sumUsageTokens([])).toBe(0);
    expect(sumUsageTokens(undefined as unknown as [])).toBe(0);
  });
});

describe('armDeepResearchBudget', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('aborts the run when the wall-clock budget elapses', () => {
    const ac = new AbortController();
    const dispose = armDeepResearchBudget({
      abortController: ac,
      collectedUsage: [],
      budget: { wallClockMs: 1000, tokenBudget: 0 },
    });
    expect(ac.signal.aborted).toBe(false);
    jest.advanceTimersByTime(1001);
    expect(ac.signal.aborted).toBe(true);
    dispose();
  });

  it('aborts only once the token budget is exceeded', () => {
    const ac = new AbortController();
    const usage: Array<{ total_tokens?: number }> = [];
    const dispose = armDeepResearchBudget({
      abortController: ac,
      collectedUsage: usage,
      budget: { wallClockMs: 0, tokenBudget: 500 },
    });
    jest.advanceTimersByTime(2001);
    expect(ac.signal.aborted).toBe(false); // still under budget
    usage.push({ total_tokens: 600 });
    jest.advanceTimersByTime(2001);
    expect(ac.signal.aborted).toBe(true); // now over budget
    dispose();
  });

  it('dispose clears timers so no late abort fires', () => {
    const ac = new AbortController();
    const dispose = armDeepResearchBudget({
      abortController: ac,
      collectedUsage: [],
      budget: { wallClockMs: 1000, tokenBudget: 0 },
    });
    dispose();
    jest.advanceTimersByTime(5000);
    expect(ac.signal.aborted).toBe(false);
  });

  it('does not re-abort an already-aborted controller (no spurious warn)', () => {
    const ac = new AbortController();
    ac.abort();
    const warn = jest.fn();
    const dispose = armDeepResearchBudget({
      abortController: ac,
      collectedUsage: [],
      budget: { wallClockMs: 1000, tokenBudget: 0 },
      logger: { warn },
    });
    jest.advanceTimersByTime(2000);
    expect(warn).not.toHaveBeenCalled();
    dispose();
  });
});
