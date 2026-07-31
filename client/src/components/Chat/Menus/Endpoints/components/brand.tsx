import { GPTIcon, AnthropicIcon, MoonshotIcon, XAIcon } from '@librechat/client';

/**
 * Colored assets (theme-safe as-is); monochrome brands render as components below.
 *
 * `nvidia`, `minimax` and `meta` come from lobehub/lobe-icons (MIT); the rest ship
 * with upstream. Each mark stays the property of the vendor it names and is used
 * here only to identify that vendor's models.
 */
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
  nvidia: '/assets/nvidia.svg',
  minimax: '/assets/minimax.svg',
  'meta-llama': '/assets/meta.svg',
};

/**
 * Z.ai, whose GLM models a real catalogue carries a dozen of.
 *
 * Inline rather than an asset file because the mark is monochrome: loaded through
 * `<img>` it would draw in the SVG document's own colour — black, and invisible on
 * a dark theme. Drawn as a component it takes the surrounding text colour. Path
 * from lobehub/lobe-icons (MIT).
 */
function ZaiIcon({ size }: { size: number }): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      fillRule="evenodd"
      aria-hidden="true"
      focusable="false"
      className="text-text-primary"
    >
      <path d="M12.105 2L9.927 4.953H.653L2.83 2h9.276zM23.254 19.048L21.078 22h-9.242l2.174-2.952h9.244zM24 2L9.264 22H0L14.736 2H24z" />
    </svg>
  );
}

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
 * Backgrounds for the letter stand-in, every one of them at least 5:1 against
 * white. The letter is always white, so the circle carries its own contrast and
 * reads the same on either theme — a `text-text-secondary` grey does not, and a
 * palette picked for one theme goes muddy on the other.
 */
const INITIAL_COLORS = [
  '#B91C1C',
  '#B45309',
  '#15803D',
  '#0F766E',
  '#1D4ED8',
  '#6D28D9',
  '#A21CAF',
  '#BE185D',
];

/** Same vendor, same colour, every render and every session — including the
 *  server's, where a random or time-based pick would not survive hydration. */
function colorFor(vendor: string): string {
  let sum = 0;
  for (let index = 0; index < vendor.length; index++) {
    sum += vendor.charCodeAt(index);
  }
  return INITIAL_COLORS[sum % INITIAL_COLORS.length];
}

/**
 * A stand-in for a vendor we have no mark for.
 *
 * A real catalogue carries some fifty vendors and we ship marks for a dozen, so
 * without this two out of five rows render no avatar at all and their labels sit
 * out of line with everyone else's. The letter is not branding — it is a shape
 * that keeps the column aligned, and giving each vendor its own colour makes two
 * of them tell apart at the same glance a logo would.
 */
function VendorInitial({ vendor, size }: { vendor: string; size: number }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      style={{ fontSize: Math.max(10, Math.round(size * 0.62)), backgroundColor: colorFor(vendor) }}
      className="flex h-full w-full select-none items-center justify-center rounded-full font-semibold uppercase leading-none text-white"
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
  if (vendor === 'moonshotai') {
    return <MoonshotIcon className="h-full w-full text-text-primary" />;
  }
  if (vendor === 'x-ai') {
    return <XAIcon className="h-full w-full text-text-primary" />;
  }
  if (vendor === 'z-ai') {
    return <ZaiIcon size={size} />;
  }
  const asset = Object.prototype.hasOwnProperty.call(BRAND_ASSETS, vendor)
    ? BRAND_ASSETS[vendor]
    : undefined;
  if (!asset) {
    return <VendorInitial vendor={vendor} size={size} />;
  }
  return <img src={asset} alt="" aria-hidden="true" className="h-full w-full object-contain" />;
}
