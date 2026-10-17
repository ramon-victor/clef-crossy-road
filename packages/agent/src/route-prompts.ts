import type { Question } from "@ccr/clef";
import { STANDABLE } from "./lanes.ts";

/**
 * The `lookup` manual of the `route` strategy (ADR-0011). Three small questions in one request, each a
 * single lookup of a single field of the state (the model read a two-field rule as one field: still water
 * came out as "passing" in 12 of 12 probe states, 2026-10-15), each with solved examples (the way the Mario
 * project writes "dx 79 -> false, dx 35 -> true" into its instructions). The same for every state; nothing in
 * the text is worked out from the state in front of the model. Putting the answers together is code:
 * a cell the chicken can stand on, or things that keep moving, mean "cross"; otherwise the third
 * question picks a side.
 */
const STANDABLE_WORDS = STANDABLE.join(", ").replace(/, ([^,]*)$/, " or $1");

export const LOOKUP_GAME = [
  "You control a chicken in a Crossy Road style game. It crosses rows of grass, road, rail and water, and the world keeps moving while it hops.",
  "You pick a manoeuvre and a controller does the hopping: it waits for the right moment, and for a detour it walks the way round (back one row if it must, along the row, then forward onto a row not reached yet), checking the world at every hop.",
  "A cell holds one of these words: empty, tree, water (open water, no platform), log, lily_pad, vehicle, train, train_coming (the rail warning light is on), outside_world (past the edge of the world) or unseen.",
  `The chicken can stand on ${STANDABLE_WORDS} and on nothing else: a tree stops it, water drowns it, a vehicle or a train hits it, and outside_world kills it.`,
].join(" ");

/** The legend of the whole state, for the question that reads all of it. */
export const SCENE_NOTE = [
  "Each manoeuvre has an entry in the state under its own name.",
  "cross_ahead.lands_on is the cell where a hop straight ahead lands, and cross_ahead.things_move the way the vehicles or logs of that row move on the screen (still when they stand still).",
  "detour_left and detour_right: opening_ahead says how far to that side the nearest cell of the row ahead is where the chicken could end a hop (adjacent, two_away, three_or_more, or none); own_row_that_way says how many cells of its own row that way it could step on (blocked_at_once, free_for_one, free_for_two_or_more); recently_failed is yes when the controller already gave that detour back since the last new row.",
  "wait_here.stands_on is what is under the chicken if it stays. chicken.behind_frontier says whether it stands behind the furthest row it has reached (no, one, two_or_more).",
  "memory lists its last moves with what each did, and last_maneuver says how the previous manoeuvre went.",
].join(" ");

/** The part of the legend the two questions about the row ahead need. */
const AHEAD_NOTE =
  "The state has an entry cross_ahead: lands_on is the cell where a hop straight ahead lands, and things_move the way the vehicles or logs of that row move on the screen (left, right, or still when they stand still).";

const CELL_EXAMPLES = [
  "Examples:",
  "lands_on empty -> stand.",
  "lands_on lily_pad -> stand.",
  "lands_on log -> stand.",
  "lands_on water -> no_stand.",
  "lands_on vehicle -> no_stand.",
  "lands_on train_coming -> no_stand.",
  "lands_on tree -> no_stand.",
  "lands_on outside_world -> no_stand.",
].join(" ");

const MOVING_EXAMPLES = [
  "Examples:",
  "things_move left -> moving.",
  "things_move right -> moving.",
  "things_move still -> still.",
].join(" ");

const AROUND_EXAMPLES = [
  "Examples:",
  "detour_left.opening_ahead two_away and detour_right.opening_ahead none -> detour_left.",
  "left none and right adjacent -> detour_right.",
  "left three_or_more and right two_away -> detour_right.",
  "left two_away and right adjacent -> detour_right.",
  "left adjacent and right two_away -> detour_left.",
  "left adjacent and right adjacent, chicken.place_in_world middle -> detour_left.",
  "left adjacent and right adjacent, chicken.place_in_world left -> detour_right.",
  "left adjacent but recently_failed yes, right three_or_more -> detour_right.",
  "left none and right none -> wait_here.",
  "left two_away but recently_failed yes, right none -> wait_here.",
].join(" ");

/**
 * The fourth question, asked only while the chicken stands on a platform (ADR-0011, addendum). Its note is written
 * here and not in `LOOKUP_GAME`, so that every request made off a platform stays as it was. It asks for a plain
 * match of one word, because that is what the model does well: asked in words ("is the platform about to carry the
 * chicken past the edge?", with or without the reason and with the examples, 2026-10-17) it answered `leaving` in 3 of
 * 12 states a moment from the edge and in none of the other 12, while "is edge_in a_moment?" got 12 of 12 and 0 of 12.
 */
const RIDE_NOTE =
  "The state has an entry chicken: edge_in is one of a_moment, soon, later or not_carried.";

const RIDE_EXAMPLES = [
  "Examples:",
  "chicken.edge_in a_moment -> leaving.",
  "chicken.edge_in soon -> staying.",
  "chicken.edge_in later -> staying.",
  "chicken.edge_in not_carried -> staying.",
].join(" ");

export const ROUTE_QUESTION_IDS = ["cell", "moving", "around"] as const;
export const RIDE_QUESTION_ID = "ride";
export const CELL_OPTIONS = ["stand", "no_stand"] as const;
export const MOVING_OPTIONS = ["moving", "still"] as const;
export const AROUND_OPTIONS = ["detour_left", "detour_right", "wait_here"] as const;
export const RIDE_OPTIONS = ["leaving", "staying"] as const;

export const CELL_CRITERIA: Readonly<Record<(typeof CELL_OPTIONS)[number], string>> = {
  stand: `cross_ahead.lands_on is ${STANDABLE_WORDS}.`,
  no_stand: "cross_ahead.lands_on is tree, water, vehicle, train, train_coming or outside_world.",
};

export const MOVING_CRITERIA: Readonly<Record<(typeof MOVING_OPTIONS)[number], string>> = {
  moving: "cross_ahead.things_move is left or right.",
  still: "cross_ahead.things_move is still.",
};

export const AROUND_CRITERIA: Readonly<Record<(typeof AROUND_OPTIONS)[number], string>> = {
  detour_left:
    "The left side has an opening (detour_left.opening_ahead is not none and detour_left.recently_failed is no) and the right side has none or a farther one; or both are equally near and chicken.place_in_world is middle, right or at_right_edge.",
  detour_right:
    "The right side has an opening (detour_right.opening_ahead is not none and detour_right.recently_failed is no) and the left side has none or a farther one; or both are equally near and chicken.place_in_world is left or at_left_edge.",
  wait_here:
    "Neither side has an opening: both opening_ahead are none, or the side that has one has recently_failed yes.",
};

export const RIDE_CRITERIA: Readonly<Record<(typeof RIDE_OPTIONS)[number], string>> = {
  leaving: "chicken.edge_in is a_moment.",
  staying: "chicken.edge_in is soon, later or not_carried.",
};

/**
 * The three questions of the `route` strategy, and a fourth while the chicken stands on a platform. `cell` and
 * `moving` read the row straight ahead; `around` only matters when the way straight ahead is closed (the cell
 * cannot be stood on and nothing moves); `ride` reads the clock of the platform under the chicken.
 */
export function routeQuestions(riding = false): Record<string, Question> {
  const ahead = `${LOOKUP_GAME} ${AHEAD_NOTE}`;
  const ride: Record<string, Question> = riding
    ? {
        [RIDE_QUESTION_ID]: {
          type: "choice",
          instructions: `${LOOKUP_GAME} ${RIDE_NOTE} Is chicken.edge_in a_moment? Read only chicken.edge_in. ${RIDE_EXAMPLES}`,
          criteria: { ...RIDE_CRITERIA },
        },
      }
    : {};
  return {
    cell: {
      type: "choice",
      instructions: `${ahead} Can the chicken stand on the cell where a hop straight ahead lands? Read only cross_ahead.lands_on. ${CELL_EXAMPLES}`,
      criteria: { ...CELL_CRITERIA },
    },
    moving: {
      type: "choice",
      instructions: `${ahead} Do the vehicles or logs of the row straight ahead move? Read only cross_ahead.things_move. ${MOVING_EXAMPLES}`,
      criteria: { ...MOVING_CRITERIA },
    },
    around: {
      type: "choice",
      instructions: `${LOOKUP_GAME} ${SCENE_NOTE} Suppose the way straight ahead is closed. Which manoeuvre does the chicken start? Compare the two sides, nearer is better: adjacent, then two_away, then three_or_more. ${AROUND_EXAMPLES}`,
      criteria: { ...AROUND_CRITERIA },
    },
    ...ride,
  };
}
