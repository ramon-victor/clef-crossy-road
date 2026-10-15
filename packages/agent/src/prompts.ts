import type { Action } from "@ccr/core";
import type { EncoderId } from "./encode.ts";
import type { Maneuver } from "./executor.ts";
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
 * rules: for the `lanes` view only. The rules of the game plus options that name the fields of that view
 * and the words they can hold, the way the Doom player of the other Jev projects writes its threshold into
 * the option text. It measures whether the model applies a written policy to words, and is labelled so
 * (ADR-0010). The same for every state.
 * ordered: for the `moves` view only. Short options, each one a single rule about its own entry of the
 * state, to be tried in a stated order, the first that is true wins (the options of `rules` measured too
 * alike and too long: the model's answers came out nearly flat). Measured with several options true at
 * once in most states, and the model took a later one instead of the first (`hop_left` when everything was
 * free, `hop_back` where `stay` was right).
 * exclusive: for the `moves` view only. The same game text and the same short options, but each one also
 * states the cases that rule it out, so exactly one is true in any state (what the Doom `rule` options do:
 * "do not pick this if...").
 */
export const MANUAL_IDS = ["full", "minimal", "routing", "rules", "ordered", "exclusive"] as const;
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

/** The rules and the vocabulary of the `lanes` view. Field names are explained by the view's own note. */
const RULES = [
  "You control a chicken in a Crossy Road style game. It crosses rows of grass, road, rail and water, one hop at a time, and the world keeps moving while it hops.",
  "A decision is one hop of 0.2 seconds, or staying still for that long.",
  "The state has already worked out what fills the cells the chicken could land on, for the moment a hop ends.",
  "A cell holds one of these words: empty (nothing there), tree, water (open water, no platform), log, lily_pad, vehicle, train, train_coming (the rail warning light is on), outside_world (past the edge of the world) or unseen.",
  "The chicken can stand on empty, log and lily_pad and on nothing else: a tree stops it (it stays where it was), water drowns it, a vehicle or a train hits it, and outside_world kills it.",
  "A log or lily pad carries the chicken sideways while it stands on it.",
  "The moves: hop_forward goes one row ahead, hop_back one row behind, hop_left one column to the left, hop_right one column to the right, and stay waits.",
].join(" ");

/** The rules and the vocabulary of the `moves` view. Each move has an entry in the state under its own name. */
const ORDERED = [
  "You control a chicken in a Crossy Road style game. It hops across rows of grass, road, rail and water while the world keeps moving. A decision is one hop of 0.2 seconds, or staying still.",
  "The state says, for each move, what fills the cell where that move would land, already worked out for the moment the hop ends.",
  "A cell holds one of these words: empty, tree, water (open water, no platform), log, lily_pad, vehicle, train, train_coming (the rail warning light is on), outside_world (past the edge of the world) or unseen.",
  "The chicken can stand on empty, log and lily_pad and on nothing else: a tree stops it, water drowns it, a vehicle or a train hits it, and outside_world kills it.",
].join(" ");

export const MANUALS: Readonly<Record<ManualId, string>> = {
  minimal: MINIMAL,
  full: FULL,
  routing: ROUTING,
  rules: RULES,
  ordered: ORDERED,
  exclusive: ORDERED,
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

const STANDABLE_WORDS = "empty, log or lily_pad";

/**
 * Options that name the fields of the `lanes` view and the words they hold. Each says when it is the
 * right move, the same for every state; none of them is worked out from the state in front of the model.
 */
export const RULES_CRITERIA: Readonly<Record<Action, string>> = {
  hop_forward: `Correct when forward.lands_on is ${STANDABLE_WORDS}: the chicken can stand where a hop forward lands.`,
  hop_left: `Correct when forward.lands_on is not ${STANDABLE_WORDS}, and sideways.left_lands_on is ${STANDABLE_WORDS}, and forward.lands_on_after_stepping_left is ${STANDABLE_WORDS}. If the same is true of hop_right, take the side away from the nearer edge (chicken.place_in_world). Also correct when chicken.stays_on is not ${STANDABLE_WORDS} and sideways.left_lands_on is.`,
  hop_right: `Correct when forward.lands_on is not ${STANDABLE_WORDS}, and sideways.right_lands_on is ${STANDABLE_WORDS}, and forward.lands_on_after_stepping_right is ${STANDABLE_WORDS}. If the same is true of hop_left, take the side away from the nearer edge (chicken.place_in_world). Also correct when chicken.stays_on is not ${STANDABLE_WORDS} and sideways.right_lands_on is.`,
  stay: `Correct when forward.lands_on is not ${STANDABLE_WORDS}, neither side step leads to a forward cell that is, and chicken.stays_on is ${STANDABLE_WORDS}: where the chicken stands cannot hurt it, so it waits for the row ahead to open.`,
  hop_back: `Correct only when chicken.stays_on is not ${STANDABLE_WORDS}, neither side can be stood on, and backward.lands_on is ${STANDABLE_WORDS}.`,
};

/** The `maneuver` strategy: the model picks what to do, the controller picks the moment and hops. */
export const MANEUVER_CRITERIA: Readonly<Record<Maneuver, string>> = {
  cross_ahead: `Go forward through the row ahead; the controller waits for the right moment and hops. Correct when forward.lands_on is ${STANDABLE_WORDS}, or when it is water, vehicle, train or train_coming and forward.things_move is left or right (logs or traffic keep passing, so a place will open). Not correct when forward.lands_on is a tree.`,
  sidestep_left: `Step one column to the left, then be asked again; the controller hops when that cell can be stood on. Correct when going straight ahead will not work (forward.lands_on is a tree, or water in a row where forward.things_move is no) and forward.lands_on_after_stepping_left is ${STANDABLE_WORDS}.`,
  sidestep_right: `Step one column to the right, then be asked again; the controller hops when that cell can be stood on. Correct when going straight ahead will not work (forward.lands_on is a tree, or water in a row where forward.things_move is no) and forward.lands_on_after_stepping_right is ${STANDABLE_WORDS}. If the left side works too, take the side away from the nearer edge (chicken.place_in_world).`,
  back_off: `Go one row back, then be asked again. Correct only when chicken.stays_on is not ${STANDABLE_WORDS}, neither side can be stood on, and backward.lands_on is ${STANDABLE_WORDS}.`,
  wait_here: `Do nothing for one step, then be asked again. Correct when no other option applies and chicken.stays_on is ${STANDABLE_WORDS}.`,
};

const FIRST = "Only if none of the moves before it is true.";

/**
 * Short options for the `moves` view: one rule each, about the entry of the state that carries the
 * option's own name, to be tried in the order the question gives. The same for every state.
 */
export const ORDERED_CRITERIA: Readonly<Record<Action, string>> = {
  hop_forward: `True when hop_forward.lands_on is ${STANDABLE_WORDS}.`,
  hop_left: `True when hop_left.lands_on and hop_left.then_hop_forward_lands_on are both ${STANDABLE_WORDS}. ${FIRST}`,
  hop_right: `True when hop_right.lands_on and hop_right.then_hop_forward_lands_on are both ${STANDABLE_WORDS}. ${FIRST}`,
  stay: `True when stay.stands_on is ${STANDABLE_WORDS}. ${FIRST}`,
  hop_back: `True when hop_back.lands_on is ${STANDABLE_WORDS}. ${FIRST}`,
};

const NOT_STANDABLE = `is NOT ${STANDABLE_WORDS}`;

/**
 * The `ordered` options with the cases that rule each one out written in, so that exactly one of them is
 * true in any state.
 */
export const EXCLUSIVE_CRITERIA: Readonly<Record<Action, string>> = {
  hop_forward: `True when hop_forward.lands_on is ${STANDABLE_WORDS}. When it is true, no other move is.`,
  hop_left: `True only when hop_forward.lands_on ${NOT_STANDABLE}, and hop_left.lands_on and hop_left.then_hop_forward_lands_on are both ${STANDABLE_WORDS}.`,
  hop_right: `True only when hop_forward.lands_on ${NOT_STANDABLE}, and hop_left is not true, and hop_right.lands_on and hop_right.then_hop_forward_lands_on are both ${STANDABLE_WORDS}.`,
  stay: `True only when hop_forward.lands_on ${NOT_STANDABLE}, and neither hop_left nor hop_right is true, and stay.stands_on is ${STANDABLE_WORDS}.`,
  hop_back: `True only when stay.stands_on ${NOT_STANDABLE}, and hop_forward, hop_left and hop_right are not true, and hop_back.lands_on is ${STANDABLE_WORDS}.`,
};

/** The same, for the manoeuvres of the `maneuver` strategy: the controller picks the moment and hops. */
export const ORDERED_MANEUVER_CRITERIA: Readonly<Record<Maneuver, string>> = {
  cross_ahead: `Go straight ahead; the controller waits for the right moment and hops. True when cross_ahead.lands_on is ${STANDABLE_WORDS}, or when it is water, vehicle, train or train_coming and cross_ahead.things_move is left or right (things keep passing, so a place will open) and wait_here.stands_on is ${STANDABLE_WORDS}.`,
  sidestep_left: `Step one column left; the controller hops when the cell is clear. True when sidestep_left.lands_on and sidestep_left.then_cross_ahead_lands_on are both ${STANDABLE_WORDS}. ${FIRST}`,
  sidestep_right: `Step one column right; the controller hops when the cell is clear. True when sidestep_right.lands_on and sidestep_right.then_cross_ahead_lands_on are both ${STANDABLE_WORDS}. ${FIRST}`,
  wait_here: `Wait one step. True when wait_here.stands_on is ${STANDABLE_WORDS}. ${FIRST}`,
  back_off: `Go one row back. True when back_off.lands_on is ${STANDABLE_WORDS}. ${FIRST}`,
};

/**
 * The `graph` strategy asks two small questions in one request instead of one with five options: can the
 * chicken hop forward, and if not, which other move. The options of each are exclusive by construction.
 */
export const GRAPH_GO_CRITERIA = {
  go: `hop_forward.lands_on is ${STANDABLE_WORDS}.`,
  hold: `hop_forward.lands_on ${NOT_STANDABLE}.`,
} as const;

export const GRAPH_SIDE_CRITERIA: Readonly<Record<Exclude<Action, "hop_forward">, string>> = {
  hop_left: `hop_left.lands_on and hop_left.then_hop_forward_lands_on are both ${STANDABLE_WORDS}.`,
  hop_right: `hop_left is not true, and hop_right.lands_on and hop_right.then_hop_forward_lands_on are both ${STANDABLE_WORDS}.`,
  stay: `neither hop_left nor hop_right is true, and stay.stands_on is ${STANDABLE_WORDS}.`,
  hop_back: `neither hop_left nor hop_right is true, stay.stands_on ${NOT_STANDABLE}, and hop_back.lands_on is ${STANDABLE_WORDS}.`,
};

export const GRAPH_QUESTION_IDS = ["go", "side"] as const;

/** The instructions of each question of the `graph` strategy (the `moves` view with the game text of `ordered`). */
export function graphInstructions(question: (typeof GRAPH_QUESTION_IDS)[number]): string {
  const common = `${MANUALS.ordered} ${MOVES_NOTE}`;
  return question === "go"
    ? `${common} Can the chicken hop forward? It can when hop_forward.lands_on is ${STANDABLE_WORDS}.`
    : `${common} The chicken cannot hop forward, because hop_forward.lands_on is not ${STANDABLE_WORDS}. Which other move does it make? Exactly one of these is true; if none is, take stay.`;
}

/**
 * The same two questions for the manoeuvres (`graph-maneuver`): can the chicken cross the row ahead (which
 * includes waiting for a gap in moving traffic or logs), and if not, which other manoeuvre. The controller
 * picks the moment and does the hopping.
 */
const MANEUVER_ADDENDUM =
  "The moves are manoeuvres: a controller waits for the right moment and does the hopping, then the chicken is asked again; memory.last_maneuver says how the previous one went, and cross_ahead.things_move is the way the vehicles or logs of the row ahead move on the screen (no when they stand still).";

const CROSSABLE = `cross_ahead.lands_on is ${STANDABLE_WORDS}, or it is water, vehicle, train or train_coming and cross_ahead.things_move is left or right and wait_here.stands_on is ${STANDABLE_WORDS}`;

export const GRAPH_MANEUVER_GO_CRITERIA = {
  go: `${CROSSABLE} (things keep passing, so a place will open).`,
  hold: `cross_ahead.lands_on is a tree, or it is water, vehicle, train or train_coming and either cross_ahead.things_move is no or wait_here.stands_on ${NOT_STANDABLE}.`,
} as const;

export const GRAPH_MANEUVER_SIDE_CRITERIA: Readonly<
  Record<Exclude<Maneuver, "cross_ahead">, string>
> = {
  sidestep_left: `sidestep_left.lands_on and sidestep_left.then_cross_ahead_lands_on are both ${STANDABLE_WORDS}.`,
  sidestep_right: `sidestep_left is not true, and sidestep_right.lands_on and sidestep_right.then_cross_ahead_lands_on are both ${STANDABLE_WORDS}.`,
  wait_here: `neither sidestep_left nor sidestep_right is true, and wait_here.stands_on is ${STANDABLE_WORDS}.`,
  back_off: `neither sidestep_left nor sidestep_right is true, wait_here.stands_on ${NOT_STANDABLE}, and back_off.lands_on is ${STANDABLE_WORDS}.`,
};

export function graphManeuverInstructions(question: (typeof GRAPH_QUESTION_IDS)[number]): string {
  const note = MOVES_NOTE.replace(
    "then_hop_forward_lands_on is the cell where a hop forward would land one hop later, after that sidestep",
    "then_cross_ahead_lands_on is the cell where crossing ahead would land one hop later, after that sidestep",
  );
  const common = `${MANUALS.ordered} ${note} ${MANEUVER_ADDENDUM}`;
  return question === "go"
    ? `${common} Can the chicken cross the row straight ahead? It can when ${CROSSABLE}.`
    : `${common} The chicken cannot cross the row straight ahead. Which manoeuvre does it start instead? Exactly one of these is true; if none is, take wait_here.`;
}

/** The options of a choice question for this prompt style. */
export function criteriaFor(manual: ManualId): Readonly<Record<Action, string>>;
export function criteriaFor(
  manual: ManualId,
  strategy: "maneuver",
): Readonly<Record<Maneuver, string>>;
export function criteriaFor(manual: ManualId, strategy?: string): Readonly<Record<string, string>> {
  if (strategy === "maneuver")
    return manual === "ordered" ? ORDERED_MANEUVER_CRITERIA : MANEUVER_CRITERIA;
  if (manual === "routing") return ROUTING_CRITERIA;
  if (manual === "ordered") return ORDERED_CRITERIA;
  if (manual === "exclusive") return EXCLUSIVE_CRITERIA;
  return manual === "rules" ? RULES_CRITERIA : ACTION_CRITERIA;
}

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

/** How the `lanes` view is read. A legend of its fields, nothing more. */
const LANES_NOTE =
  "In the state, chicken.stays_on is what is under the chicken when this hop ends if it does not move. forward.lands_on is the cell a hop forward lands on; forward.lands_on_after_stepping_left and forward.lands_on_after_stepping_right are the cell a hop forward would land on one hop later, if the chicken first stepped one column to that side. sideways.left_lands_on and sideways.right_lands_on are the cells a hop to that side lands on, and backward.lands_on the cell a hop back lands on. forward.things_move is the way the vehicles or logs of the row ahead move on the screen (no when they stand still); chicken.carried_towards is the way a platform carries the chicken; chicken.place_in_world says how close it is to the left or right edge of the world, where it dies. memory lists its last moves with what each did; blocked_last_two is true when its last two moves were both stopped by a tree, and no_new_row_for_a_while when several moves have passed without reaching a new row.";

const MANEUVER_NOTE =
  "The moves are manoeuvres: a controller waits for the right moment and does the hopping, then the chicken is asked again. memory.last_maneuver says how the previous one went.";

/** How the `moves` view is read. Short: the keys of the state are the names of the moves. */
const MOVES_NOTE =
  "Each move has an entry in the state under its own name. lands_on is the cell where that move lands; then_hop_forward_lands_on is the cell where a hop forward would land one hop later, after that sidestep; stands_on is what is under the chicken if it stays. chicken says how close it is to the edges of the world, where it dies, and which way a platform carries it. memory lists its last moves with what each did.";

const ENCODER_NOTES: Readonly<Partial<Record<EncoderId, string>>> = {
  lanes: LANES_NOTE,
  moves: MOVES_NOTE,
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
  rules:
    "Which move does the chicken make now? Check the options in this order: hop_forward, then the side steps, then stay, then leaving a spot it cannot stand on.",
  exclusive:
    "Which move does the chicken make now? Exactly one of these moves is true: hop_forward, hop_left, hop_right, stay or hop_back. If none is, take hop_forward.",
  ordered:
    "Which move does the chicken make now? Go through the moves in this order and take the first whose rule is true: hop_forward, hop_left, hop_right, stay, hop_back. If none is true, take hop_forward.",
};

const ORDERED_MANEUVER_QUESTION =
  "The moves are manoeuvres: a controller waits for the right moment and does the hopping, then the chicken is asked again; memory.last_maneuver says how the previous one went, and cross_ahead.things_move is the way the vehicles or logs of the row ahead move on the screen (no when they stand still). Which manoeuvre does the chicken start now? Go through them in this order and take the first whose rule is true: cross_ahead, sidestep_left, sidestep_right, wait_here, back_off. If none is true, take wait_here.";

export function choiceInstructions(
  manual: ManualId,
  encoder?: EncoderId,
  strategy?: string,
): string {
  if (strategy === "maneuver" && manual === "ordered") {
    return `${withEncoderNote(manual, encoder)} ${ORDERED_MANEUVER_QUESTION}`;
  }
  if (strategy === "maneuver") {
    return `${withEncoderNote(manual, encoder)} ${MANEUVER_NOTE} Which manoeuvre does the chicken start now?`;
  }
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
