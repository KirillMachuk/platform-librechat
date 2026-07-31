import { GPTIcon, AnthropicIcon } from '@librechat/client';

/** Colored assets (theme-safe as-is); monochrome brands render as components below. */
const BRAND_ASSETS: Record<string, string> = {
  deepseek: '/assets/deepseek.svg',
  qwen: '/assets/qwen.svg',
  google: '/assets/google.svg',
  gemini: '/assets/google.svg',
  mistral: '/assets/mistral.png',
  mistralai: '/assets/mistral.png',
  perplexity: '/assets/perplexity.png',
  cohere: '/assets/cohere.png',
  groq: '/assets/groq.png',
  ollama: '/assets/ollama.png',
  openrouter: '/assets/openrouter.png',
};

/**
 * The vendor an OpenRouter-style slug belongs to, or null when the id carries no
 * vendor at all.
 *
 * The leading `~` marks a moving pointer (`~anthropic/claude-sonnet-latest`) and is
 * not part of the vendor name — left in, every one of those lost its brand mark.
 */
function vendorOf(modelId: string | null): string | null {
  if (!modelId) {
    return null;
  }
  const slashAt = modelId.indexOf('/');
  if (slashAt <= 0) {
    return null;
  }
  const vendor = modelId.slice(0, slashAt).replace(/^~/, '').toLowerCase();
  return vendor === '' ? null : vendor;
}

/**
 * A neutral stand-in for a vendor we have no mark for.
 *
 * A real catalogue carries dozens of vendors and we ship marks for a handful, so
 * without this two out of five rows render no avatar at all and their labels sit
 * out of line with everyone else's. The letter is not branding — it is a shape
 * that keeps the column aligned and still tells two vendors apart at a glance.
 */
function VendorInitial({ vendor, size }: { vendor: string; size: number }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      style={{ fontSize: Math.max(9, Math.round(size * 0.55)) }}
      className="flex h-full w-full items-center justify-center rounded-full bg-surface-tertiary font-semibold uppercase leading-none text-text-secondary"
    >
      {vendor.slice(0, 1)}
    </span>
  );
}

/**
 * Brand icon for an OpenRouter-style model slug ("vendor/model"). Monochrome brand
 * marks draw with currentColor (text-text-primary) so they stay visible in both
 * themes.
 *
 * Returns null only for ids with no vendor segment — a built-in endpoint's bare
 * `gpt-4o`, where the caller's own endpoint icon is the better answer and an
 * initial would replace a real logo with a letter.
 */
export function getModelBrandIcon(modelId: string | null, size = 16): JSX.Element | null {
  const vendor = vendorOf(modelId);
  if (!vendor) {
    return null;
  }
  if (vendor === 'openai') {
    return <GPTIcon size={size} className="text-text-primary" />;
  }
  if (vendor === 'anthropic') {
    return <AnthropicIcon size={size} className="text-text-primary" />;
  }
  const asset = Object.prototype.hasOwnProperty.call(BRAND_ASSETS, vendor)
    ? BRAND_ASSETS[vendor]
    : undefined;
  if (!asset) {
    return <VendorInitial vendor={vendor} size={size} />;
  }
  return <img src={asset} alt="" aria-hidden="true" className="h-full w-full object-contain" />;
}
