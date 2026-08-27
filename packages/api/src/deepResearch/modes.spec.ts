import { deepResearchModeSchema } from 'librechat-data-provider';
import type { TDeepResearchConfig } from 'librechat-data-provider';
import { resolveDeepResearchMode, DEEP_RESEARCH_MODE_DEFAULTS } from './modes';

/**
 * Provider routing for a Deep Research tier.
 *
 * Deep Research builds its own model clients and never saw the model spec's `addParams`,
 * so every DR call went out unpinned and OpenRouter picked the platform. That became a
 * real defect once balanced moved to a slug whose platforms differ in price and
 * quantisation. These tests pin the resolver's contract; the wire-level check that the
 * value actually reaches the request body lives in `deepResearchRun.provider.spec.js`.
 */
describe('resolveDeepResearchMode: provider routing', () => {
  const withMode = (provider: unknown): TDeepResearchConfig =>
    ({
      activeMode: 'balanced',
      modes: { balanced: { provider } },
    }) as unknown as TDeepResearchConfig;

  it('carries the tier pin through, defaulting allow_fallbacks to true', () => {
    const mode = resolveDeepResearchMode(withMode({ order: ['DeepInfra', 'Fireworks'] }));
    expect(mode.provider).toEqual({
      order: ['DeepInfra', 'Fireworks'],
      allow_fallbacks: true,
    });
  });

  it('keeps allow_fallbacks: false — the whole point of restricting to the list', () => {
    const mode = resolveDeepResearchMode(
      withMode({ order: ['Fireworks'], allow_fallbacks: false }),
    );
    expect(mode.provider).toEqual({ order: ['Fireworks'], allow_fallbacks: false });
  });

  it('leaves the tier unpinned when no provider is configured', () => {
    const mode = resolveDeepResearchMode({
      activeMode: 'balanced',
      modes: { balanced: { leadModel: 'x/y' } },
    } as unknown as TDeepResearchConfig);
    expect(mode.provider).toBeUndefined();
  });

  it('treats an EMPTY order as unpinned, not as a pin to nothing', () => {
    // `{"order": []}` reads as "no preference" to OpenRouter while the config reads as
    // "pinned": a tier that looks pinned would silently route anywhere. Say unpinned.
    expect(resolveDeepResearchMode(withMode({ order: [] })).provider).toBeUndefined();
  });

  it('drops blank entries and unpins when nothing survives', () => {
    expect(resolveDeepResearchMode(withMode({ order: ['  ', ''] })).provider).toBeUndefined();
    expect(resolveDeepResearchMode(withMode({ order: ['', 'Together'] })).provider).toEqual({
      order: ['Together'],
      allow_fallbacks: true,
    });
  });

  it('does not leak one tier’s pin into the other', () => {
    const config = {
      activeMode: 'deep',
      modes: {
        balanced: { provider: { order: ['DeepInfra'] } },
        deep: { leadModel: 'anthropic/claude-opus-5' },
      },
    } as unknown as TDeepResearchConfig;
    // A DeepSeek-first list on the Anthropic tier with allow_fallbacks:false would fail
    // every call — no platform in that list serves Claude.
    expect(resolveDeepResearchMode(config).provider).toBeUndefined();
  });
});

/**
 * The knobs promoted out of the engine (`budgetGateRatio`, `timeGateRatio`, `digestCap`,
 * `compressInputChars`, `toolResultWindow`) are declared WITHOUT a zod default, unlike the
 * older numbers in the same schema.
 *
 * The reason is that one schema describes BOTH tiers while the sensible value differs per
 * tier: a default in the shared schema is a value with nowhere correct to live. The per-tier
 * defaults are `DEEP_RESEARCH_MODE_DEFAULTS`, and the resolver reads `override.x ?? base.x`
 * — for which a field carrying a schema default is indistinguishable from a field an admin
 * set on purpose. So the schema stays silent and the tier decides.
 */
describe('resolveDeepResearchMode: knobs a config leaves out', () => {
  it('the shared schema does not invent a value for a per-tier knob', () => {
    const parsed = deepResearchModeSchema.parse({});

    expect(parsed).not.toHaveProperty('digestCap');
    expect(parsed).not.toHaveProperty('budgetGateRatio');
    expect(parsed).not.toHaveProperty('timeGateRatio');
    expect(parsed).not.toHaveProperty('compressInputChars');
    expect(parsed).not.toHaveProperty('toolResultWindow');
  });

  it('leaves the deep tier on its own knobs when the file only tunes balanced', () => {
    const mode = resolveDeepResearchMode({
      activeMode: 'deep',
      modes: { balanced: { digestCap: 1234 }, deep: { leadModel: 'lead-x' } },
    } as unknown as TDeepResearchConfig);

    expect(mode.digestCap).toBe(DEEP_RESEARCH_MODE_DEFAULTS.deep.digestCap);
    expect(mode.budgetGateRatio).toBe(DEEP_RESEARCH_MODE_DEFAULTS.deep.budgetGateRatio);
    expect(mode.compressInputChars).toBe(DEEP_RESEARCH_MODE_DEFAULTS.deep.compressInputChars);
    expect(mode.digestCap).not.toBe(1234);
  });

  it('still takes a knob the file DOES set on the active tier', () => {
    const mode = resolveDeepResearchMode({
      activeMode: 'deep',
      modes: { deep: { digestCap: 1234, toolResultWindow: 3 } },
    } as unknown as TDeepResearchConfig);

    expect(mode.digestCap).toBe(1234);
    expect(mode.toolResultWindow).toBe(3);
  });

  /**
   * The half of this trap that stayed open until the final review: the five ORIGINAL fields
   * were still `.default()`, so a `deep:` block carrying nothing but a model name pulled the
   * balanced tier's numbers over the deep tier's — 3 researchers instead of 4, 6 rounds
   * instead of 8, and 400 000 tokens of budget instead of 800 000.
   */
  it('a tier block naming only a model inherits no numbers at all', () => {
    const parsed = deepResearchModeSchema.parse({ leadModel: 'lead-x' });

    for (const knob of [
      'maxConcurrentResearchers',
      'maxOrchestratorCycles',
      'maxSearcherTurns',
      'perRunTokenBudget',
      'wallClockMinutes',
    ]) {
      expect(parsed).not.toHaveProperty(knob);
    }

    const mode = resolveDeepResearchMode({
      activeMode: 'deep',
      modes: { deep: parsed },
    } as unknown as TDeepResearchConfig);
    expect(mode.perRunTokenBudget).toBe(DEEP_RESEARCH_MODE_DEFAULTS.deep.perRunTokenBudget);
    expect(mode.maxOrchestratorCycles).toBe(DEEP_RESEARCH_MODE_DEFAULTS.deep.maxOrchestratorCycles);
    expect(mode.leadModel).toBe('lead-x');
  });

  it('rejects a knob outside its allowed range', () => {
    expect(deepResearchModeSchema.safeParse({ budgetGateRatio: 1.5 }).success).toBe(false);
    expect(deepResearchModeSchema.safeParse({ toolResultWindow: -1 }).success).toBe(false);
    expect(deepResearchModeSchema.safeParse({ digestCap: 10 }).success).toBe(false);
  });
});
