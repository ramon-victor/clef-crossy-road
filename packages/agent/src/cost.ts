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
 * (docs/05). `json-fx` comes from 100 full games; `view` and `view-fx` from the 90 probe states, which
 * sit deeper in a game than a typical decision, so they may be a little high for a short game.
 */
const CHOICE_TOKENS: Readonly<Record<EncoderId, { tokens: number; measured: boolean }>> = {
  json: { tokens: 1120, measured: true },
  grid: { tokens: 1320, measured: true },
  image: { tokens: 972, measured: true },
  "json-rel": { tokens: 1163, measured: true },
  view: { tokens: 1367, measured: true },
  "view-fx": { tokens: 1540, measured: true },
  "json-fx": { tokens: 1425, measured: true },
  // An estimate from the size of the request against `json-fx`, until a probe reads the real figure.
  lanes: { tokens: 1260, measured: false },
  moves: { tokens: 800, measured: false },
  scene: { tokens: 1650, measured: false },
};

/** The critic asks five questions, so it repeats the instructions five times. Only measured with `json`. */
const CRITIC_TOKENS = 3070;

export function decisionCost(config: {
  model: ClefModel;
  encoder: EncoderId;
  strategy: StrategyId;
}): DecisionCost {
  // Two questions in one request, each with the game text: about 1.5 times a choice with the moves view.
  if (config.strategy === "route") {
    // Two questions with their examples and the scene state in one request, an estimate until a probe reads it.
    return { tokens: 1650, measured: false, neurons: neuronsForTokens(config.model, 1650) };
  }
  if (config.strategy === "graph" || config.strategy === "graph-maneuver") {
    return { tokens: 1250, measured: false, neurons: neuronsForTokens(config.model, 1250) };
  }
  const critic = config.strategy === "critic" || config.strategy === "critic-go";
  const { tokens, measured } = critic
    ? { tokens: CRITIC_TOKENS, measured: config.encoder === "json" }
    : CHOICE_TOKENS[config.encoder];
  return { tokens, measured, neurons: neuronsForTokens(config.model, tokens) };
}
