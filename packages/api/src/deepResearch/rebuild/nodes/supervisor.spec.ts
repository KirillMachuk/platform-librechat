import { FakeListChatModel } from '@langchain/core/utils/testing';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { BaseMessage } from '@langchain/core/messages';
import type { DeepResearchState, DeepResearchNodeError, DeepResearchConfigurable } from '../state';
import {
  budgetGateReason,
  createSupervisorNode,
  routeFromSupervisor,
  normalizeSubQuestions,
} from './supervisor';
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
    currentSubQuestions: [],
    findings: [],
    round: 0,
    researcherCount: 0,
    tokenUsage: { input: 0, output: 0, total: 0 },
    usageByModel: {},
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
  /**
   * The reserve gate must refuse a round it cannot AFFORD, not merely a round that
   * starts too late. Numbers below are the stand incident of 2026-08-18 (balanced tier:
   * 12 min wall clock, timeGateRatio 0.68 → reserve at 8 min 09 s):
   * two rounds had completed in 8 min 04 s when the supervisor was asked again. The old
   * point check passed with 5 SECONDS to spare, dispatched a third round of the same
   * ~4 minutes, and the hard watchdog killed the run at 12 min with NO report —
   * findings=3, 27% of the token budget spent, twelve minutes of the user's time lost.
   */
  const INCIDENT = {
    tokenUsed: 106_247,
    tokenBudget: 400_000,
    budgetGateRatio: 0.72,
    maxRounds: 6,
    runStartedMs: 1_000_000,
    softDeadlineMs: 1_000_000 + 489_600, // 12 min × 0.68
    now: 1_000_000 + 484_000, // 8 min 04 s in, two rounds done
    round: 2,
  };

  it('stops gathering when another round would not finish before the reserve', () => {
    // Mean round = 484 s / 2 = 242 s; 484 + 242 = 726 s, past the 489.6 s reserve.
    expect(budgetGateReason(INCIDENT)).toBe('time');
  });

  it('FAILS ON PRE-FIX CODE: the old point check let this exact round through', () => {
    // Same instant, estimate suppressed — this is literally the old behaviour, and it
    // must still say "keep going". If this ever returns 'time', the test above stopped
    // proving anything (it would pass for a gate that simply always stops).
    expect(budgetGateReason({ ...INCIDENT, runStartedMs: undefined })).toBeNull();
  });

  it('still allows a round that fits inside the reserve', () => {
    // Two fast rounds: mean 60 s, now 120 s in, reserve at 489.6 s → 180 s < 489.6 s.
    expect(budgetGateReason({ ...INCIDENT, now: 1_000_000 + 120_000, tokenUsed: 0 })).toBeNull();
  });

  it('always allows the FIRST round — nothing has been measured yet', () => {
    // Otherwise a short wall clock would refuse to research at all: with no completed
    // round there is no duration to estimate, so the estimate is 0 by construction.
    expect(
      budgetGateReason({ ...INCIDENT, round: 0, tokenUsed: 0, now: 1_000_000 + 1 }),
    ).toBeNull();
  });

  it('still stops once the reserve itself is reached, estimate or not', () => {
    expect(budgetGateReason({ ...INCIDENT, now: 1_000_000 + 489_600, tokenUsed: 0 })).toBe('time');
  });

  it('does not let a backwards clock produce a negative estimate', () => {
    // now < runStartedMs would otherwise subtract from the elapsed time and let a
    // round through that the gate should refuse.
    expect(budgetGateReason({ ...INCIDENT, now: 1_000_000 - 5_000, tokenUsed: 0 })).toBeNull();
  });

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

  /**
   * The token arm's own founding case, measured on the stand: the supervisor dispatched a
   * round on ANY remaining headroom. At 287 900 spent of a 288 000 gate, three researchers
   * were handed ~33 tokens each, every one of them refused to start, and the round produced
   * nothing while still counting as a round.
   */
  const STARVED_ROUND = {
    tokenUsed: 287_900,
    round: 1,
    tokenBudget: 400_000,
    budgetGateRatio: 0.72,
    maxRounds: 6,
  };

  it('refuses a round the remaining budget cannot pay for', () => {
    // Mean round = 287 900; 287 900 + 287 900 is far past the 288 000 reserve.
    expect(budgetGateReason(STARVED_ROUND)).toBe('budget');
  });

  it('FAILS ON PRE-FIX CODE: the old point check dispatched this starved round', () => {
    // Estimate suppressed by having no completed round to measure — the old behaviour,
    // which must still say "keep going" or the test above proves nothing.
    expect(budgetGateReason({ ...STARVED_ROUND, round: 0 })).toBeNull();
  });

  it('allows a second round when the first one leaves room for it', () => {
    // 900k budget, reserve at 648k, a 300k first round: 300k + 300k fits.
    expect(
      budgetGateReason({
        tokenUsed: 300_000,
        round: 1,
        tokenBudget: 900_000,
        budgetGateRatio: 0.72,
        maxRounds: 6,
      }),
    ).toBeNull();
  });

  it('stops after the round that would cross the reserve', () => {
    expect(
      budgetGateReason({
        tokenUsed: 600_000,
        round: 2,
        tokenBudget: 900_000,
        budgetGateRatio: 0.72,
        maxRounds: 6,
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

describe('normalizeSubQuestions (A2 batch parsing)', () => {
  it('prefers the array — trims, de-dups, drops empties, caps at maxBatch', () => {
    expect(normalizeSubQuestions(['  a  ', 'b', 'a', '', 'c', 'd'], undefined, 3)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('falls back to a single subQuestion when no array is given (back-compat)', () => {
    expect(normalizeSubQuestions(undefined, 'только один', 3)).toEqual(['только один']);
  });

  it('returns [] when neither the array nor the fallback is usable', () => {
    expect(normalizeSubQuestions(undefined, '', 3)).toEqual([]);
    expect(normalizeSubQuestions([123, {}], undefined, 3)).toEqual([]);
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
  it('dispatches a researcher with the next sub-question (single, back-compat)', async () => {
    const model = new FakeListChatModel({
      responses: ['{"action":"RESEARCH","subQuestion":"Объём рынка CRM в РФ за 2025 год"}'],
    });
    const update = await createSupervisorNode({ model, tier: TIER, now: NOW, nonce: NONCE })(
      stateWith({}),
      configWith(),
    );
    expect(update.currentSubQuestion).toBe('Объём рынка CRM в РФ за 2025 год');
    expect(update.currentSubQuestions).toEqual(['Объём рынка CRM в РФ за 2025 год']);
    expect(update.round).toBe(1);
    expect(update.researcherCount).toBe(1);
    expect(update.concludeReason ?? null).toBeNull();
  });

  it('sends System RULES + Human MATERIAL, like every other node in this graph', async () => {
    /**
     * The fix this pins: SUPERVISOR used to invoke the model with a system message and
     * NOTHING else — the only node in the graph shaped that way, and the only one that
     * came back empty. Measured on the stand's lead model over the 14 real DR briefs,
     * 7 of 28 system-only calls returned zero characters; an empty answer parses to no
     * sub-questions and the node falls back to researching the whole brief as ONE
     * question, silently costing the round its parallel fan-out. Split system/human:
     * 0 of 27 empty (Fisher exact p = 0.010).
     *
     * Asserting the ROLES, not just the text: putting both halves in one system message
     * would still contain every string below and would reintroduce the defect.
     */
    const seen: BaseMessage[][] = [];
    const model = {
      invoke: async (messages: BaseMessage[]) => {
        seen.push(messages);
        return new AIMessage('{"action":"RESEARCH","subQuestions":["a","b","c"]}');
      },
    } as unknown as BaseChatModel;

    await createSupervisorNode({ model, tier: TIER, now: NOW, nonce: NONCE })(
      stateWith({}),
      configWith(),
    );

    expect(seen).toHaveLength(1);
    const [system, human] = seen[0];
    expect(seen[0]).toHaveLength(2);
    expect(system).toBeInstanceOf(SystemMessage);
    expect(human).toBeInstanceOf(HumanMessage);
    // Rules in the system half...
    expect(String(system.content)).toMatch(/СУПЕРВАЙЗЕР/);
    expect(String(system.content)).toMatch(/ПАРАЛЛЕЛЬНО/);
    // ...material in the human half, and NOT in the system one: the security directive
    // claims the task and format are set by the system message alone, and that claim is
    // only true while foreign gathered text does not share it.
    expect(String(human.content)).toContain('Исследовательский бриф');
    expect(String(system.content)).not.toContain('Исследовательский бриф');
  });

  it('dispatches a BATCH of independent sub-questions to run in parallel (A2)', async () => {
    const model = new FakeListChatModel({
      responses: [
        '{"action":"RESEARCH","subQuestions":["Цена Битрикс24","Цена amoCRM","On-prem варианты"]}',
      ],
    });
    const update = await createSupervisorNode({ model, tier: TIER, now: NOW, nonce: NONCE })(
      stateWith({ researcherCount: 2 }),
      configWith(),
    );
    expect(update.currentSubQuestions).toEqual([
      'Цена Битрикс24',
      'Цена amoCRM',
      'On-prem варианты',
    ]);
    expect(update.currentSubQuestion).toBe('Цена Битрикс24'); // first, for UI progress
    expect(update.round).toBe(1);
    expect(update.researcherCount).toBe(5); // 2 prior + 3 dispatched
  });

  it('caps the dispatched batch at the tier concurrency limit (deep = 4)', async () => {
    const model = new FakeListChatModel({
      responses: ['{"action":"RESEARCH","subQuestions":["q1","q2","q3","q4","q5","q6"]}'],
    });
    const update = await createSupervisorNode({ model, tier: TIER, now: NOW, nonce: NONCE })(
      stateWith({}),
      configWith(),
    );
    expect(update.currentSubQuestions).toHaveLength(TIER.maxConcurrentResearchers);
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

  it('REFUSES a round-0 COMPLETE: forces one research round on the brief instead', async () => {
    const model = new FakeListChatModel({ responses: ['{"action":"COMPLETE","subQuestion":""}'] });
    const update = await createSupervisorNode({ model, tier: TIER, now: NOW, nonce: NONCE })(
      stateWith({ round: 0, researchBrief: 'обзор рынка CRM' }),
      configWith(),
    );
    expect(update.concludeReason ?? null).toBeNull();
    expect(update.currentSubQuestions).toEqual(['обзор рынка CRM']);
    expect(update.round).toBe(1);
  });

  it('degrades unparseable output to researching the brief — NEVER a silent complete', async () => {
    const model = new FakeListChatModel({ responses: ['это вообще не json'] });
    const update = await createSupervisorNode({ model, tier: TIER, now: NOW, nonce: NONCE })(
      stateWith({ round: 1, researchBrief: 'обзор рынка CRM' }),
      configWith(),
    );
    expect(update.concludeReason ?? null).toBeNull();
    expect(update.currentSubQuestions).toEqual(['обзор рынка CRM']);
    expect(update.round).toBe(2);
  });

  it('a model FAILURE concludes as ERROR (partial banner), never as a fake "complete"', async () => {
    const model = new FakeListChatModel({ responses: ['x'] });
    jest.spyOn(model, 'invoke').mockRejectedValue(new Error('502 upstream'));
    const update = await createSupervisorNode({ model, tier: TIER, now: NOW, nonce: NONCE })(
      stateWith({ round: 1 }),
      configWith(),
    );
    expect(update.concludeReason).toBe('error');
    const errors = (update.errors ?? []) as DeepResearchNodeError[];
    expect(errors).toHaveLength(1);
    expect(errors[0].node).toBe('supervisor');
  });
});
