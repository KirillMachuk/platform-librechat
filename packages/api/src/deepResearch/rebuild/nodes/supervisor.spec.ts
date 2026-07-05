import { FakeListChatModel } from '@langchain/core/utils/testing';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { DeepResearchState, DeepResearchConfigurable } from '../state';
import { createSupervisorNode, routeFromSupervisor, budgetGateReason } from './supervisor';
import { resolveDeepResearchTier } from '../config';

const NOW = '2026-06-25T00:00:00Z';
const NONCE = 'test-nonce';
const TIER = resolveDeepResearchTier(); // deep: maxOrchestratorCycles = 8

function stateWith(partial: Partial<DeepResearchState>): DeepResearchState {
  return {
    messages: [],
    jurisdiction: 'RU',
    researchBrief: 'бриф',
    currentSubQuestion: '',
    findings: [],
    round: 0,
    researcherCount: 0,
    tokenUsage: { input: 0, output: 0, total: 0 },
    errors: [],
    finalReport: '',
    finalizeReason: null,
    concludeReason: null,
    ...partial,
  };
}

function configWith(tokenBudget = 800_000, budgetGateRatio = 0.75): RunnableConfig {
  const configurable: DeepResearchConfigurable = {
    runId: 'run-1',
    userId: 'user-1',
    mode: 'deep',
    budget: { wallClockMs: 900_000, tokenBudget, budgetGateRatio, timeGateRatio: 0.68 },
  };
  return { configurable };
}

describe('budgetGateReason', () => {
  it('flags budget when usage reaches the reserve threshold', () => {
    expect(
      budgetGateReason({
        tokenUsed: 600_000,
        round: 0,
        tokenBudget: 800_000,
        budgetGateRatio: 0.75,
        maxRounds: 8,
      }),
    ).toBe('budget');
  });

  it('flags rounds when the round cap is hit', () => {
    expect(
      budgetGateReason({
        tokenUsed: 0,
        round: 8,
        tokenBudget: 800_000,
        budgetGateRatio: 0.75,
        maxRounds: 8,
      }),
    ).toBe('rounds');
  });

  it('returns null while budget and rounds remain', () => {
    expect(
      budgetGateReason({
        tokenUsed: 100,
        round: 1,
        tokenBudget: 800_000,
        budgetGateRatio: 0.75,
        maxRounds: 8,
      }),
    ).toBeNull();
  });

  it('flags time once the soft deadline is reached, taking precedence over budget/rounds (A1)', () => {
    expect(
      budgetGateReason({
        tokenUsed: 700_000, // would also trip budget
        round: 8, // would also trip rounds
        tokenBudget: 800_000,
        budgetGateRatio: 0.75,
        maxRounds: 8,
        now: 10_000,
        softDeadlineMs: 10_000,
      }),
    ).toBe('time');
  });

  it('leaves the time arm OFF when now/softDeadline are unset or the deadline is in the future', () => {
    expect(
      budgetGateReason({
        tokenUsed: 100,
        round: 1,
        tokenBudget: 800_000,
        budgetGateRatio: 0.75,
        maxRounds: 8,
      }),
    ).toBeNull();
    expect(
      budgetGateReason({
        tokenUsed: 100,
        round: 1,
        tokenBudget: 800_000,
        budgetGateRatio: 0.75,
        maxRounds: 8,
        now: 5_000,
        softDeadlineMs: 10_000,
      }),
    ).toBeNull();
  });
});

describe('routeFromSupervisor', () => {
  it('routes to report once concluded', () => {
    expect(routeFromSupervisor(stateWith({ concludeReason: 'budget' }))).toBe('report');
  });

  it('routes to researcher while gathering', () => {
    expect(routeFromSupervisor(stateWith({ concludeReason: null }))).toBe('researcher');
  });
});

describe('createSupervisorNode', () => {
  it('dispatches a researcher with the next sub-question', async () => {
    const model = new FakeListChatModel({
      responses: ['{"action":"RESEARCH","subQuestion":"Объём рынка CRM в РФ за 2025 год"}'],
    });
    const update = await createSupervisorNode({ model, tier: TIER, now: NOW, nonce: NONCE })(
      stateWith({}),
      configWith(),
    );
    expect(update.currentSubQuestion).toBe('Объём рынка CRM в РФ за 2025 год');
    expect(update.round).toBe(1);
    expect(update.researcherCount).toBe(1);
    expect(update.concludeReason ?? null).toBeNull();
  });

  it('concludes when the model says COMPLETE', async () => {
    const model = new FakeListChatModel({ responses: ['{"action":"COMPLETE","subQuestion":""}'] });
    const update = await createSupervisorNode({ model, tier: TIER, now: NOW, nonce: NONCE })(
      stateWith({ round: 2 }),
      configWith(),
    );
    expect(update.concludeReason).toBe('complete');
    expect(update.currentSubQuestion ?? '').toBe('');
  });

  it('concludes on the budget gate WITHOUT calling the model', async () => {
    const model = new FakeListChatModel({ responses: ['{"action":"RESEARCH","subQuestion":"x"}'] });
    const spy = jest.spyOn(model, 'invoke');
    const update = await createSupervisorNode({ model, tier: TIER, now: NOW, nonce: NONCE })(
      stateWith({ tokenUsage: { input: 600_000, output: 0, total: 600_000 } }),
      configWith(),
    );
    expect(update.concludeReason).toBe('budget');
    expect(spy).not.toHaveBeenCalled();
  });

  it('concludes on the round cap WITHOUT calling the model', async () => {
    const model = new FakeListChatModel({ responses: ['{"action":"RESEARCH","subQuestion":"x"}'] });
    const spy = jest.spyOn(model, 'invoke');
    const update = await createSupervisorNode({ model, tier: TIER, now: NOW, nonce: NONCE })(
      stateWith({ round: 8 }),
      configWith(),
    );
    expect(update.concludeReason).toBe('rounds');
    expect(spy).not.toHaveBeenCalled();
  });

  it('concludes on the TIME gate (soft deadline passed) WITHOUT calling the model (A1)', async () => {
    const model = new FakeListChatModel({ responses: ['{"action":"RESEARCH","subQuestion":"x"}'] });
    const spy = jest.spyOn(model, 'invoke');
    const configurable: DeepResearchConfigurable = {
      runId: 'run-1',
      userId: 'user-1',
      mode: 'deep',
      budget: {
        wallClockMs: 900_000,
        tokenBudget: 800_000,
        budgetGateRatio: 0.75,
        timeGateRatio: 0.68,
      },
      softDeadlineMs: 10_000,
    };
    const update = await createSupervisorNode({
      model,
      tier: TIER,
      now: NOW,
      nonce: NONCE,
      clock: () => 10_001, // one ms past the soft deadline
    })(stateWith({}), { configurable });
    expect(update.concludeReason).toBe('time');
    expect(spy).not.toHaveBeenCalled();
  });

  it('forwards the abort signal to the model call (H1)', async () => {
    const model = new FakeListChatModel({ responses: ['{"action":"RESEARCH","subQuestion":"q"}'] });
    const spy = jest.spyOn(model, 'invoke');
    const controller = new AbortController();
    await createSupervisorNode({ model, tier: TIER, now: NOW, nonce: NONCE })(stateWith({}), {
      ...configWith(),
      signal: controller.signal,
    });
    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});
