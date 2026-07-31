import mongoose from 'mongoose';
import { EModelEndpoint } from 'librechat-data-provider';
import { createTxMethods } from '@librechat/data-schemas';
import {
  getModelMaxTokens,
  getModelMaxOutputTokens,
  hasReportedMaxOutputTokens,
  publishModelLimits,
  clearModelLimits,
  findMatchingPattern,
  matchModelName,
} from './tokens';

/**
 * The static name maps are wrong for most of a curated OpenRouter line-up, because
 * they match on name fragments a human has to keep current. These are the real
 * figures from the gateway catalogue, and the numbers the maps produce today —
 * both measured against the deployed line-up on 2026-07-29.
 *
 * Re-derive with:
 *   curl -s https://openrouter.ai/api/v1/models | jq '.data[]
 *     | select(.id=="deepseek/deepseek-v4-pro")
 *     | {ctx: .context_length, out: .top_provider.max_completion_tokens}'
 */
const DEPLOYED = [
  { model: 'deepseek/deepseek-v4-pro', nameMapCtx: 128000, realCtx: 1048576, realOut: 384000 },
  { model: 'deepseek/deepseek-v4-flash', nameMapCtx: 128000, realCtx: 1048576, realOut: 393216 },
  { model: 'deepseek/deepseek-v3.2', nameMapCtx: 128000, realCtx: 163840, realOut: 65536 },
  { model: 'qwen/qwen3.7-max', nameMapCtx: 40960, realCtx: 1000000, realOut: 65536 },
  { model: 'qwen/qwen3-235b-a22b-2507', nameMapCtx: 40960, realCtx: 262144, realOut: 16384 },
];

const asOverlay = (rows: typeof DEPLOYED) =>
  Object.fromEntries(
    rows.map((row) => [row.model, { contextTokens: row.realCtx, maxOutputTokens: row.realOut }]),
  );

afterEach(() => clearModelLimits());

describe('token limits reported by the gateway', () => {
  it('leaves every lookup untouched until a gateway reports something', () => {
    for (const { model, nameMapCtx } of DEPLOYED) {
      expect(getModelMaxTokens(model, EModelEndpoint.custom)).toBe(nameMapCtx);
    }
  });

  it('replaces the name-matched window with the reported one', () => {
    publishModelLimits('gw', asOverlay(DEPLOYED));

    for (const { model, realCtx } of DEPLOYED) {
      expect(getModelMaxTokens(model, EModelEndpoint.custom)).toBe(realCtx);
    }
  });

  it('replaces the name-matched output ceiling with the reported one', () => {
    publishModelLimits('gw', asOverlay(DEPLOYED));

    for (const { model, realOut } of DEPLOYED) {
      expect(getModelMaxOutputTokens(model, EModelEndpoint.custom)).toBe(realOut);
    }
  });

  /** The name map claims 32000 here against a real 16384 — an over-request the
   *  provider rejects. Correcting downwards matters as much as upwards. */
  it('lowers a ceiling the name map overstates', () => {
    expect(getModelMaxOutputTokens('qwen/qwen3-235b-a22b-2507', EModelEndpoint.custom)).toBe(32000);

    publishModelLimits('gw', asOverlay(DEPLOYED));

    expect(getModelMaxOutputTokens('qwen/qwen3-235b-a22b-2507', EModelEndpoint.custom)).toBe(16384);
  });

  /**
   * A model added upstream tomorrow gets real limits with no code change. Without
   * a report there is no answer at all, and the agent runtime then falls back to
   * `DEFAULT_MAX_CONTEXT_TOKENS` (32000) — a 30× under-estimate for a 1M model.
   */
  it('serves a model no static map has ever heard of', () => {
    expect(
      getModelMaxTokens('vendor/model-from-the-future', EModelEndpoint.custom),
    ).toBeUndefined();

    publishModelLimits('gw', { 'vendor/model-from-the-future': { contextTokens: 700000 } });

    expect(getModelMaxTokens('vendor/model-from-the-future', EModelEndpoint.custom)).toBe(700000);
  });

  it('matches the full model id and never a fragment of one', () => {
    publishModelLimits('gw', { 'deepseek/deepseek-v4-pro': { contextTokens: 1048576 } });

    expect(getModelMaxTokens('deepseek/deepseek-v4-pro-preview', EModelEndpoint.custom)).toBe(
      128000,
    );
    expect(getModelMaxTokens('deepseek-v4-pro', EModelEndpoint.custom)).toBe(128000);
  });

  it('falls back per field, not per model', () => {
    publishModelLimits('gw', { 'deepseek/deepseek-v4-pro': { contextTokens: 1048576 } });

    expect(getModelMaxTokens('deepseek/deepseek-v4-pro', EModelEndpoint.custom)).toBe(1048576);
    /** No ceiling reported → the name map still answers. */
    expect(getModelMaxOutputTokens('deepseek/deepseek-v4-pro', EModelEndpoint.custom)).toBe(8000);
  });

  it('lets an explicit admin override win over the gateway', () => {
    publishModelLimits('gw', asOverlay(DEPLOYED));

    expect(
      getModelMaxTokens('deepseek/deepseek-v4-pro', EModelEndpoint.custom, {
        'deepseek/deepseek-v4-pro': { context: 50000, prompt: 1, completion: 1 },
      }),
    ).toBe(50000);
  });

  /** Losing the gateway must not shrink windows mid-conversation. */
  it('keeps the last good answer when a later report is empty', () => {
    publishModelLimits('gw', asOverlay(DEPLOYED));
    publishModelLimits('gw', {});

    expect(getModelMaxTokens('deepseek/deepseek-v4-pro', EModelEndpoint.custom)).toBe(1048576);
  });

  /**
   * Endpoints are resolved concurrently and each publishes separately, so a
   * replacing store would let whichever finished last erase the others on every
   * request.
   */
  it('keeps models from every endpoint that reported', () => {
    publishModelLimits('gw-a', { 'gatewayA/model': { contextTokens: 111000 } });
    publishModelLimits('gw-b', { 'gatewayB/model': { contextTokens: 222000 } });

    expect(getModelMaxTokens('gatewayA/model', EModelEndpoint.custom)).toBe(111000);
    expect(getModelMaxTokens('gatewayB/model', EModelEndpoint.custom)).toBe(222000);
  });

  it('lets a fresher report correct a model it already knew', () => {
    publishModelLimits('gw', { 'a/model': { contextTokens: 100 } });
    publishModelLimits('gw', { 'a/model': { contextTokens: 200000 } });

    expect(getModelMaxTokens('a/model', EModelEndpoint.custom)).toBe(200000);
  });

  /**
   * Publishing happens several times per request with the same held object, so the
   * repeat must not rebuild a several-hundred-key map — but a genuinely new object
   * with the same contents still has to be applied.
   */
  it('applies an equal-but-different report, and skips the identical one', () => {
    const held = { 'a/model': { contextTokens: 111000 } };
    publishModelLimits('gw', held);
    publishModelLimits('gw', held);
    expect(getModelMaxTokens('a/model', EModelEndpoint.custom)).toBe(111000);

    publishModelLimits('gw', { 'a/model': { contextTokens: 222000 } });
    expect(getModelMaxTokens('a/model', EModelEndpoint.custom)).toBe(222000);
  });

  it('reports whether a ceiling is known, for callers that only clamp known models', () => {
    expect(hasReportedMaxOutputTokens('deepseek/deepseek-v4-pro', EModelEndpoint.custom)).toBe(
      false,
    );

    publishModelLimits('gw', asOverlay(DEPLOYED));

    expect(hasReportedMaxOutputTokens('deepseek/deepseek-v4-pro', EModelEndpoint.custom)).toBe(
      true,
    );
    expect(hasReportedMaxOutputTokens('vendor/unknown', EModelEndpoint.custom)).toBe(false);
    /** A built-in endpoint never reads what a gateway published for someone else. */
    expect(hasReportedMaxOutputTokens('deepseek/deepseek-v4-pro', EModelEndpoint.openAI)).toBe(
      false,
    );
  });

  it('survives non-string model names', () => {
    publishModelLimits('gw', asOverlay(DEPLOYED));

    expect(() =>
      getModelMaxTokens(undefined as unknown as string, EModelEndpoint.custom),
    ).not.toThrow();
  });
});

/**
 * The overlay carries limits only. Pricing must not travel with it: `getMultiplier`
 * prefers a listed model's rates and drops to `defaultRate` for a record that omits
 * them, so a limits channel that leaked into pricing would silently move analytics
 * rates. Money is accounted for outside the platform, from what the provider
 * actually charged.
 */
describe('money is not touched by reported limits', () => {
  it('leaves every rate exactly where it was', () => {
    /** Adapters: TxDeps types are looser than the utils signatures. */
    const { getMultiplier, getCacheMultiplier } = createTxMethods(mongoose, {
      matchModelName: (model, endpoint) => matchModelName(model, endpoint as EModelEndpoint),
      findMatchingPattern: (model, values) =>
        findMatchingPattern(model, values as Record<string, number>) ?? undefined,
    });

    const rateFor = (model: string) => ({
      prompt: getMultiplier({ model, tokenType: 'prompt', endpoint: EModelEndpoint.custom }),
      completion: getMultiplier({
        model,
        tokenType: 'completion',
        endpoint: EModelEndpoint.custom,
      }),
      cacheRead: getCacheMultiplier({ model, cacheType: 'read', endpoint: EModelEndpoint.custom }),
      cacheWrite: getCacheMultiplier({
        model,
        cacheType: 'write',
        endpoint: EModelEndpoint.custom,
      }),
    });

    const before = DEPLOYED.map((row) => rateFor(row.model));

    publishModelLimits('gw', asOverlay(DEPLOYED));

    expect(DEPLOYED.map((row) => rateFor(row.model))).toEqual(before);
  });
});

describe('what a gateway may not redefine', () => {
  beforeEach(() => clearModelLimits());
  afterEach(() => clearModelLimits());

  /**
   * A proxy that serves unprefixed ids would otherwise rewrite the built-in
   * endpoint's window for users who never touch that gateway: an exact entry in
   * an endpoint's own map is a curated statement and outranks a coincidence.
   */
  it('leaves a built-in endpoint alone when a gateway serves the same id', () => {
    const native = getModelMaxTokens('gpt-4o', EModelEndpoint.openAI);

    publishModelLimits('proxy', { 'gpt-4o': { contextTokens: 8192, maxOutputTokens: 4096 } });

    expect(getModelMaxTokens('gpt-4o', EModelEndpoint.openAI)).toBe(native);
    expect(hasReportedMaxOutputTokens('gpt-4o', EModelEndpoint.openAI)).toBe(false);
    /** …while the endpoint the catalogue belongs to still gets the real figures. */
    expect(getModelMaxTokens('gpt-4o', EModelEndpoint.custom)).toBe(8192);
  });

  /** But a model nobody listed is still answered by the gateway that serves it. */
  it('still answers for a model the static maps only guess at', () => {
    publishModelLimits('proxy', { 'deepseek/deepseek-v4-pro': { contextTokens: 1048576 } });

    expect(getModelMaxTokens('deepseek/deepseek-v4-pro', EModelEndpoint.custom)).toBe(1048576);
  });

  /** Republishing replaces what that endpoint said, so a retired model does not linger. */
  it('drops a model an endpoint stops reporting', () => {
    publishModelLimits('gw', { 'a/retired': { contextTokens: 999000 } });
    publishModelLimits('gw', { 'a/current': { contextTokens: 111000 } });

    expect(getModelMaxTokens('a/retired', EModelEndpoint.custom)).not.toBe(999000);
    expect(getModelMaxTokens('a/current', EModelEndpoint.custom)).toBe(111000);
  });
});
