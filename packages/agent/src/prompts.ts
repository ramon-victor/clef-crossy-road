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

/** How the chicken's column is used in the `json-rel` view. A description of the coordinates, nothing more. */
const RELATIVE_NOTE =
  "In this view every entity position is given as dcol (blocked_dcols for trees): the entity's column minus the chicken's own column, so dcol 0 is straight ahead of the chicken, and the chicken's centre is inside an entity when |dcol| < half_extent. player.col is still the chicken's absolute column.";

const MEMORY_NOTE =
  "It also lists the chicken's last moves, oldest first, with what each one did, the number of rows crossed so far, and how many moves have passed since the chicken last reached a new row.";

const FORECAST_NOTE =
  "It also shows where each moving object's centre will be 0.2 seconds from now, which is when a hop that starts now lands; objects keep moving at their own speed and the chicken is not drawn there.";

/** How the `view` map is read. A legend of the drawing, nothing more. */
const VIEW_NOTE =
  "In this view the world is drawn as a text map around the chicken, which is @ in the row marked dz=0 (rows with larger dz are further ahead, so the top of the map is the furthest). Each cell is one column; the columns run from -5 to +5 relative to the chicken's own column, so the middle cell is straight ahead of it, and # is outside the world. Cells: . open ground or empty road, T tree, ~ water, L log, o lily pad, > vehicle moving to larger col, < vehicle moving to smaller col, X train or stopped vehicle, = rail. Next to each row with moving objects are their exact numbers: dcol is the object's centre minus the chicken's column and half is its half_extent, so the chicken's centre is inside an object when |dcol| < half.";

const ENCODER_NOTES: Readonly<Partial<Record<EncoderId, string>>> = {
  image: IMAGE_LEGEND,
  "json-rel": RELATIVE_NOTE,
  view: `${VIEW_NOTE} ${MEMORY_NOTE}`,
  "view-fx": `${VIEW_NOTE} A second map shows the moving objects 0.2 seconds from now, which is when a hop that starts now lands; they keep moving at their own speed and the chicken is not drawn on it. ${MEMORY_NOTE}`,
  "json-fx": `${RELATIVE_NOTE} ${FORECAST_NOTE} ${MEMORY_NOTE}`,
};

/** The manual, plus what the reader needs to know about how this encoder writes the world. */
const withEncoderNote = (manual: ManualId, encoder?: EncoderId): string => {
  const note = encoder === undefined ? undefined : ENCODER_NOTES[encoder];
  return note === undefined ? MANUALS[manual] : `${MANUALS[manual]} ${note}`;
};

export function choiceInstructions(manual: ManualId, encoder?: EncoderId): string {
  return `${withEncoderNote(manual, encoder)} Choose the single best action for this decision step.`;
}

const ACTION_VERB: Readonly<Record<Action, string>> = {
  hop_forward: "hops one row forward",
  hop_back: "hops one row backward",
  hop_left: "hops one column to the left",
  hop_right: "hops one column to the right",
  stay: "does not move",
};

export function riskInstructions(manual: ManualId, action: Action, encoder?: EncoderId): string {
  return `${withEncoderNote(manual, encoder)} Answer yes if the chicken dies during this decision step when it ${ACTION_VERB[action]}. If the move is blocked by a tree the chicken stays where it is.`;
}

export function riskQuestionId(action: Action): string {
  return `dies_if_${action}`;
}
