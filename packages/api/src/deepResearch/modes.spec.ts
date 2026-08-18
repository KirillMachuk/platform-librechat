import type { TDeepResearchConfig } from 'librechat-data-provider';
import { resolveDeepResearchMode } from './modes';

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
