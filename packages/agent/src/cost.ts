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
 * Input tokens per `choice` decision on Clef-flash, read from `usage.input_tokens` on 2026-10-14
 * (docs/05). The `view` and `json-fx` figures are estimates from the size of their text, scaled by the
 * ratio the measured encoders showed, until a run reads the real count.
 */
const CHOICE_TOKENS: Readonly<Record<EncoderId, { tokens: number; measured: boolean }>> = {
  json: { tokens: 1120, measured: true },
  grid: { tokens: 1320, measured: true },
  image: { tokens: 972, measured: true },
  "json-rel": { tokens: 1163, measured: true },
  view: { tokens: 1450, measured: false },
  "view-fx": { tokens: 1550, measured: false },
  "json-fx": { tokens: 1550, measured: false },
};

/** The critic asks five questions, so it repeats the instructions five times. Only measured with `json`. */
const CRITIC_TOKENS = 3070;

export function decisionCost(config: {
  model: ClefModel;
  encoder: EncoderId;
  strategy: StrategyId;
}): DecisionCost {
  const critic = config.strategy !== "choice";
  const { tokens, measured } = critic
    ? { tokens: CRITIC_TOKENS, measured: config.encoder === "json" }
    : CHOICE_TOKENS[config.encoder];
  return { tokens, measured, neurons: neuronsForTokens(config.model, tokens) };
}
