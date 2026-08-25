import { configSchema } from 'librechat-data-provider';
import type { TDeepResearchConfig } from 'librechat-data-provider';
import { resolveDeepResearchMode, DEEP_RESEARCH_MODE_DEFAULTS } from './modes';

/**
 * The knobs promoted out of the engine are declared `.optional()`, not `.default()`, and
 * this is the reason. `librechat.yaml` is parsed with `configSchema.strict().safeParse`, so
 * a `.default()` materialises on EVERY tier block present in the file — and the resolver
 * reads `override.x ?? base.x`, for which a defaulted field is "set". The deep tier, whose
 * block sets models but not gate ratios, would then silently run on the balanced tier's
 * numbers while the config file said nothing of the sort.
 */
describe('tier knobs a config file leaves out', () => {
  const parseModes = (modes: Record<string, unknown>) => {
    const result = configSchema.strict().safeParse({
      version: '1.3.7',
      deepResearch: { activeMode: 'deep', modes },
    });
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data.deepResearch as TDeepResearchConfig;
  };

  it('does not materialise a shared default over a tier that omits them', () => {
    const config = parseModes({
      balanced: { digestCap: 1234 },
      deep: { leadModel: 'lead-x' },
    });

    expect(config.modes?.deep?.digestCap).toBeUndefined();
    expect(config.modes?.deep?.budgetGateRatio).toBeUndefined();
    expect(config.modes?.deep?.compressInputChars).toBeUndefined();
    expect(config.modes?.deep?.toolResultWindow).toBeUndefined();
  });

  it('leaves the deep tier on its own defaults when the file only tunes balanced', () => {
    const tier = resolveDeepResearchMode(parseModes({ balanced: { digestCap: 1234 } }));

    expect(tier.name).toBe('deep');
    expect(tier.digestCap).toBe(DEEP_RESEARCH_MODE_DEFAULTS.deep.digestCap);
    expect(tier.budgetGateRatio).toBe(DEEP_RESEARCH_MODE_DEFAULTS.deep.budgetGateRatio);
    expect(tier.compressInputChars).toBe(DEEP_RESEARCH_MODE_DEFAULTS.deep.compressInputChars);
  });

  it('still takes a value the file DOES set', () => {
    const tier = resolveDeepResearchMode(parseModes({ deep: { digestCap: 1234 } }));
    expect(tier.digestCap).toBe(1234);
  });

  it('rejects a knob outside its allowed range', () => {
    const result = configSchema.strict().safeParse({
      version: '1.3.7',
      deepResearch: { modes: { balanced: { budgetGateRatio: 1.5 } } },
    });
    expect(result.success).toBe(false);
  });
});
