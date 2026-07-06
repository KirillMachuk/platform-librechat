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
};

/**
 * Brand icon for an OpenRouter-style model slug ("vendor/model"). Monochrome brand
 * marks draw with currentColor (text-text-primary) so they stay visible in both
 * themes; unknown vendors return null so callers can fall back.
 */
export function getModelBrandIcon(modelId: string | null, size = 16): JSX.Element | null {
  const brand = modelId?.split('/')[0]?.toLowerCase() ?? '';
  if (!brand) {
    return null;
  }
  if (brand === 'openai') {
    return <GPTIcon size={size} className="text-text-primary" />;
  }
  if (brand === 'anthropic') {
    return <AnthropicIcon size={size} className="text-text-primary" />;
  }
  const asset = BRAND_ASSETS[brand];
  if (!asset) {
    return null;
  }
  return <img src={asset} alt="" aria-hidden="true" className="h-full w-full object-contain" />;
}
