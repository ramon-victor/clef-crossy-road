import type { Action } from "@ccr/core";
import type { EncoderId } from "./encode.ts";
import { IMAGE_LEGEND } from "./image.ts";

/**
 * Prompt text is versioned: a change bumps PROMPT_VERSION, which is part of every cache key and
 * every result record. The manual describes the rules of the world. It must stay a description of
 * physics; it must never say which move is safe or good in a given situation (ADR-0005).
 */
export const PROMPT_VERSION = "p1";

export const MANUAL_IDS = ["full", "minimal"] as const;
export type ManualId = (typeof MANUAL_IDS)[number];

const MINIMAL = [
  "You control a chicken in a Crossy Road style game and pick one action per decision step.",
  "Goal: get as far forward as possible without dying. Rows with larger dz are further ahead.",
  "Coordinates: col grows towards the right of the screen. dz is the row offset from the chicken's row (dz 0 is its own row, dz 1 the next row ahead, dz -1 the row behind).",
  "Speeds are in columns per second; a positive speed moves towards larger col.",
  "One decision step: the chicken starts its hop at once, then the world advances 0.2 seconds while the hop finishes.",
].join(" ");

const FULL = [
  MINIMAL,
  "Hops: hop_forward changes dz by +1, hop_back by -1, hop_left changes col by -1, hop_right by +1, stay does nothing.",
  "Terrain: grass rows may have trees at blocked_cols, and the chicken cannot enter a blocked column (it stays where it is). Road rows have vehicles. Water rows have platforms (logs and lily pads). Rail rows have a train and a warning light, which is on for 3 seconds each time the train reappears at the far end of its track.",
  "Entities: every vehicle, platform and train has a centre col and a half_extent. The chicken's centre is inside an entity when |chicken col - entity col| < half_extent.",
  "The chicken dies if its centre is inside a vehicle on its row; a vehicle can hit it while it is still hopping onto that row. A train only hits it once the hop has finished.",
  "On a water row, once the hop has finished, the chicken dies unless its centre is inside a platform; a platform carries the chicken at its own speed.",
  "The chicken also dies if |col| > 5.",
  "Vehicles, logs and trains wrap around: after passing |col| = 11 (|col| = 110 for trains) they reappear on the opposite side.",
].join(" ");

export const MANUALS: Readonly<Record<ManualId, string>> = { minimal: MINIMAL, full: FULL };

/** Option ids are sorted as strings and read by the model, so they are descriptive. */
export const ACTION_CRITERIA: Readonly<Record<Action, string>> = {
  hop_forward: "Hop one row forward (dz +1), same column.",
  hop_back: "Hop one row backward (dz -1), same column.",
  hop_left: "Hop one column to the left (col -1), same row.",
  hop_right: "Hop one column to the right (col +1), same row.",
  stay: "Do not move during this decision step.",
};

const withLegend = (manual: ManualId, encoder?: EncoderId): string =>
  encoder === "image" ? `${MANUALS[manual]} ${IMAGE_LEGEND}` : MANUALS[manual];

export function choiceInstructions(manual: ManualId, encoder?: EncoderId): string {
  return `${withLegend(manual, encoder)} Choose the single best action for this decision step.`;
}

const ACTION_VERB: Readonly<Record<Action, string>> = {
  hop_forward: "hops one row forward",
  hop_back: "hops one row backward",
  hop_left: "hops one column to the left",
  hop_right: "hops one column to the right",
  stay: "does not move",
};

export function riskInstructions(manual: ManualId, action: Action, encoder?: EncoderId): string {
  return `${withLegend(manual, encoder)} Answer yes if the chicken dies during this decision step when it ${ACTION_VERB[action]}. If the move is blocked by a tree the chicken stays where it is.`;
}

export function riskQuestionId(action: Action): string {
  return `dies_if_${action}`;
}
