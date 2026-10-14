export type ClefModel = "clef" | "clef-flash" | "clef-omni";

export const CLEF_MODELS: readonly ClefModel[] = ["clef", "clef-flash", "clef-omni"];

/**
 * US$ per million input tokens (developers.cloudflare.com, verified 2026-10-14). Output tokens
 * are not charged. Neurons are derived from the published rate of US$ 0.011 per 1,000 neurons:
 * 0.038 USD/M -> 3,455 neurons/M for clef-flash and 0.240 USD/M -> 21,818 for clef both match the
 * pricing page.
 */
export const USD_PER_MILLION_INPUT_TOKENS: Readonly<Record<ClefModel, number>> = {
  clef: 0.24,
  "clef-flash": 0.038,
  "clef-omni": 0.15,
};

export const USD_PER_1000_NEURONS = 0.011;

/** Free tier per Cloudflare account and day (resets at 00:00 UTC). */
export const FREE_NEURONS_PER_DAY = 10_000;

export function neuronsForTokens(model: ClefModel, inputTokens: number): number {
  const usd = (USD_PER_MILLION_INPUT_TOKENS[model] * inputTokens) / 1_000_000;
  return (usd / USD_PER_1000_NEURONS) * 1000;
}

export function usdForTokens(model: ClefModel, inputTokens: number): number {
  return (USD_PER_MILLION_INPUT_TOKENS[model] * inputTokens) / 1_000_000;
}
