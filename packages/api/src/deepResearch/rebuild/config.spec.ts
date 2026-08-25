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
    expect(tier.digestCap).toBe(8000);
    expect(tier.compressInputChars).toBe(205_000);
    expect(tier.toolResultWindow).toBe(1);
    expect(tier.perRunTokenBudget).toBe(800_000);
    expect(tier.wallClockMinutes).toBe(15);
  });

  it('resolves a configured tier with admin model overrides', () => {
    const config = {
      activeMode: 'balanced',
      modes: { balanced: { leadModel: 'lead-x', workerModel: 'worker-y' } },
    } as TDeepResearchConfig;

    const tier = resolveDeepResearchTier(config);
    expect(tier.name).toBe('balanced');
    expect(tier.leadModel).toBe('lead-x');
    expect(tier.workerModel).toBe('worker-y');
    expect(tier.compressModel).toBe('worker-y');
    expect(tier.budgetGateRatio).toBe(0.72);
    expect(tier.digestCap).toBe(6000);
  });

  /**
   * The point of moving these off `TIER_EXTRAS`: reaching them used to mean editing the
   * engine and rebuilding the image. If this test ever goes green on a tier that ignores
   * the override, the knobs are decorative again.
   */
  it('takes the gate ratios, digest cap, compress cap and tool window from config', () => {
    const tier = resolveDeepResearchTier({
      activeMode: 'balanced',
      modes: {
        balanced: {
          budgetGateRatio: 0.5,
          timeGateRatio: 0.4,
          digestCap: 3333,
          compressInputChars: 44_444,
          toolResultWindow: 2,
        },
      },
    } as TDeepResearchConfig);

    expect(tier.budgetGateRatio).toBe(0.5);
    expect(tier.timeGateRatio).toBe(0.4);
    expect(tier.digestCap).toBe(3333);
    expect(tier.compressInputChars).toBe(44_444);
    expect(tier.toolResultWindow).toBe(2);
  });

  it('keeps the tier default for a knob the config leaves out', () => {
    const tier = resolveDeepResearchTier({
      activeMode: 'balanced',
      modes: { balanced: { digestCap: 3333 } },
    } as TDeepResearchConfig);

    expect(tier.digestCap).toBe(3333);
    expect(tier.compressInputChars).toBe(165_000);
    expect(tier.budgetGateRatio).toBe(0.72);
  });

  it('gives the retired economy tier balanced knobs, not deep ones', () => {
    const tier = resolveDeepResearchTier({
      activeMode: 'economy',
    } as unknown as TDeepResearchConfig);
    expect(tier.name).toBe('balanced');
    expect(tier.digestCap).toBe(6000);
    expect(tier.perRunTokenBudget).toBe(400_000);
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

  it('honours writerModel for the report, leaving the lead to orchestrate', () => {
    // The field was declared, merged, typed and returned by the admin API — and read by
    // nothing. An admin who set it got a platform that accepted the value and ignored it.
    const withWriter = resolveDeepResearchTier({
      activeMode: 'balanced',
      modes: {
        balanced: { leadModel: 'lead-x', workerModel: 'worker-y', writerModel: 'writer-z' },
      },
    } as TDeepResearchConfig);
    expect(reportModelFor(withWriter)).toBe('writer-z');
    expect(leadModelFor(withWriter)).toBe('lead-x');
  });

  it('skips a reasoning conversation model that would 400 on tool loops', () => {
    const noWorker = resolveDeepResearchTier({
      activeMode: 'balanced',
      modes: { balanced: { leadModel: 'gpt-4o' } },
    } as TDeepResearchConfig);
    expect(workerModelFor(noWorker, 'o1-preview')).toBe('gpt-4o');
  });
});
