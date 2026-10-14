import { type ClefModel, neuronsForTokens } from "@ccr/clef";
import type { StrategyId } from "./clef-policy.ts";
import type { EncoderId } from "./encode.ts";

export interface DecisionCost {
  /** Input tokens one decision uses. */
  tokens: number;
  /** False when the figure is an estimate rather than something read back from the API. */
  measured: boolean;
  neurons: number;
}

/**
 * Input tokens per decision on Clef-flash, read from `usage.input_tokens` on 2026-10-14 (docs/05).
 * The critic asks five questions, so it repeats the instructions five times. It was only measured with
 * the JSON encoder; the other encoders reuse that size as an estimate.
 */
const TOKENS = { choice: { json: 1120, grid: 1320, image: 972 }, critic: 3070 } as const;

export function decisionCost(config: {
  model: ClefModel;
  encoder: EncoderId;
  strategy: StrategyId;
}): DecisionCost {
  const critic = config.strategy !== "choice";
  const tokens = critic ? TOKENS.critic : TOKENS.choice[config.encoder];
  const measured = !critic || config.encoder === "json";
  return { tokens, measured, neurons: neuronsForTokens(config.model, tokens) };
}
