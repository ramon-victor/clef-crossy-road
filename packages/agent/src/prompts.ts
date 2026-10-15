import type { Action } from "@ccr/core";
import type { EncoderId } from "./encode.ts";
import { IMAGE_LEGEND } from "./image.ts";

/**
 * Prompt text is versioned: a change bumps PROMPT_VERSION, which is part of every cache key and
 * every result record. The manual describes the rules of the world. It must stay a description of
 * physics; it must never say which move is safe or good in a given situation (ADR-0005).
 */
export const PROMPT_VERSION = "p1";

/**
 * full / minimal: the rules in prose, and options that say what each move does (the first conditions
 * of the benchmark, kept as they were so their cached answers stay valid).
 * routing: the way the service's documentation uses a choice question: a short question, and options
 * that say when each one applies. The rules and the options are the same for every state: general
 * knowledge of how the game is played, nothing worked out from the state (ADR-0009).
 */
export const MANUAL_IDS = ["full", "minimal", "routing"] as const;
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

/** The rules without field names: each view's note says what its fields are called. */
const ROUTING = [
  "You control a chicken in a Crossy Road style game and pick one move per decision. It crosses rows of grass, road, rail and water.",
  "Rows with larger dz are further ahead (dz 0 is the chicken's own row), larger col is towards the right of the screen, and speeds are in columns per second.",
  "A decision is one hop of 0.2 seconds, and the world keeps moving while it hops.",
  "The chicken cannot enter a tree: it stays where it is.",
  "On a road it is hit if a vehicle covers its column while it is on that row. On rail a train kills it, and the warning light is on when one is coming.",
  "On water it drowns unless its centre is inside a log or lily pad when the hop ends, and a platform carries it along.",
  "It also dies if its own column goes beyond 5 to either side.",
  "An object covers the chicken's column when the distance between their centres is less than the object's half_extent.",
  "The moves: hop_forward goes one row ahead, hop_back one row behind, hop_left one column to the left (col -1), hop_right one to the right (col +1), and stay waits.",
].join(" ");

export const MANUALS: Readonly<Record<ManualId, string>> = {
  minimal: MINIMAL,
  full: FULL,
  routing: ROUTING,
};

/** Option ids are sorted as strings and read by the model, so they are descriptive. */
export const ACTION_CRITERIA: Readonly<Record<Action, string>> = {
  hop_forward: "Hop one row forward (dz +1), same column.",
  hop_back: "Hop one row backward (dz -1), same column.",
  hop_left: "Hop one column to the left (col -1), same row.",
  hop_right: "Hop one column to the right (col +1), same row.",
  stay: "Do not move during this decision step.",
};

/**
 * Options that say when each move applies, the way the service's own example does ("billing: payments,
 * invoices and refunds"). The same for every state and free of numbers: how a player knows the game,
 * not something worked out from the state in front of the model.
 */
export const ROUTING_CRITERIA: Readonly<Record<Action, string>> = {
  hop_forward:
    "The row straight ahead can be entered when the hop ends: no tree in the chicken's column, and on water a log or lily pad under that column, on a road no vehicle there, on rail no train and no warning light.",
  hop_back:
    "The chicken is stuck (it keeps bumping into trees, or no column leads forward) or it is about to be hit, and the row behind is better than staying.",
  hop_left:
    "The way straight ahead cannot be entered, and the column to the left has no tree and leads towards a row that can be entered.",
  hop_right:
    "The way straight ahead cannot be entered, and the column to the right has no tree and leads towards a row that can be entered.",
  stay: "The way straight ahead cannot be entered yet but is about to open (a platform drifting under the column, a vehicle about to pass), and the chicken is not in danger where it stands.",
};

/** The options of a choice question for this prompt style. */
export const criteriaFor = (manual: ManualId): Readonly<Record<Action, string>> =>
  manual === "routing" ? ROUTING_CRITERIA : ACTION_CRITERIA;

/** What the plain `json` fields are called, for the style whose rules carry no field names. */
const ABSOLUTE_NOTE =
  "In the state each row has dz and kind; grass rows list blocked_cols (the columns with a tree), road rows list vehicles, water rows list platforms (type log or lily_pad) and rail rows have a train and a warning_light. Every vehicle, platform and train has col (its centre), half_extent and speed_cols_per_s, and player.col is the chicken's own column.";

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
  const own = encoder === undefined ? undefined : ENCODER_NOTES[encoder];
  const note = own ?? (manual === "routing" && encoder === "json" ? ABSOLUTE_NOTE : undefined);
  return note === undefined ? MANUALS[manual] : `${MANUALS[manual]} ${note}`;
};

const CHOICE_QUESTION: Readonly<Record<ManualId, string>> = {
  full: "Choose the single best action for this decision step.",
  minimal: "Choose the single best action for this decision step.",
  routing: "Which move does the chicken make now?",
};

export function choiceInstructions(manual: ManualId, encoder?: EncoderId): string {
  return `${withEncoderNote(manual, encoder)} ${CHOICE_QUESTION[manual]}`;
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
