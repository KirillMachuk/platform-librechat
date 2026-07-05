import type { TDeepResearchConfig } from 'librechat-data-provider';
import {
  tierToRunBudget,
  leadModelFor,
  workerModelFor,
  reportModelFor,
  compressModelFor,
  resolveDeepResearchTier,
} from './config';

describe('resolveDeepResearchTier', () => {
  it('defaults to the deep tier with its graph knobs', () => {
    const tier = resolveDeepResearchTier();
    expect(tier.name).toBe('deep');
    expect(tier.budgetGateRatio).toBe(0.75);
    expect(tier.timeGateRatio).toBe(0.7);
    expect(tier.digestCap).toBe(2000);
    expect(tier.perRunTokenBudget).toBe(800_000);
    expect(tier.wallClockMinutes).toBe(15);
  });

  it('resolves a configured tier with admin model overrides', () => {
    const config = {
      activeMode: 'economy',
      modes: { economy: { leadModel: 'lead-x', workerModel: 'worker-y' } },
    } as TDeepResearchConfig;

    const tier = resolveDeepResearchTier(config);
    expect(tier.name).toBe('economy');
    expect(tier.leadModel).toBe('lead-x');
    expect(tier.workerModel).toBe('worker-y');
    expect(tier.compressModel).toBe('worker-y');
    expect(tier.budgetGateRatio).toBe(0.7);
    expect(tier.digestCap).toBe(800);
  });
});

describe('tierToRunBudget', () => {
  it('derives wall-clock ms, token budget, and gate ratio', () => {
    const budget = tierToRunBudget(resolveDeepResearchTier());
    expect(budget.wallClockMs).toBe(15 * 60_000);
    expect(budget.tokenBudget).toBe(800_000);
    expect(budget.budgetGateRatio).toBe(0.75);
    expect(budget.timeGateRatio).toBe(0.7);
  });
});

describe('per-node model resolution', () => {
  const tier = resolveDeepResearchTier({
    activeMode: 'balanced',
    modes: { balanced: { leadModel: 'lead-x', workerModel: 'worker-y' } },
  } as TDeepResearchConfig);

  it('routes lead/report to the lead model and worker/compress to the worker model', () => {
    expect(leadModelFor(tier)).toBe('lead-x');
    expect(reportModelFor(tier)).toBe('lead-x');
    expect(workerModelFor(tier)).toBe('worker-y');
    expect(compressModelFor(tier)).toBe('worker-y');
  });

  it('skips a reasoning conversation model that would 400 on tool loops', () => {
    const noWorker = resolveDeepResearchTier({
      activeMode: 'balanced',
      modes: { balanced: { leadModel: 'gpt-4o' } },
    } as TDeepResearchConfig);
    expect(workerModelFor(noWorker, 'o1-preview')).toBe('gpt-4o');
  });
});
