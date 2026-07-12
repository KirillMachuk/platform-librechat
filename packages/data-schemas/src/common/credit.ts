/**
 * Money model of the billing «Кредиты»:
 *   1 Credit = $0.01 of actual OpenRouter cost (100 Credits = $1).
 * Internally everything is accounted in integer micro-USD (1e-6 USD) so that
 * per-request rounding never accumulates; only *displayed* totals are rounded
 * to whole Credits.
 */
export const MICRO_USD_PER_USD = 1_000_000;
/** $0.01 in µ$. */
export const MICRO_USD_PER_CREDIT = 10_000;
export const CREDITS_PER_USD = 100;

/** Converts a USD float (OpenRouter `usage.cost`) to integer micro-USD. */
export function usdToMicroUsd(usd: number): number {
  return Math.round(usd * MICRO_USD_PER_USD);
}

/** Converts integer micro-USD to whole display Credits (rounded). */
export function microUsdToCredits(microUsd: number): number {
  return Math.round(microUsd / MICRO_USD_PER_CREDIT);
}

/** Converts whole Credits to integer micro-USD (exact). */
export function creditsToMicroUsd(credits: number): number {
  return credits * MICRO_USD_PER_CREDIT;
}
