import { ACTIONS, type Action } from "@ccr/core";
import { ACTION_GLYPH, ACTION_LABEL, ACTION_ORDER } from "../format.ts";

/**
 * The words a person reads for the questions and options the model is sent. The ids are the model's (they are
 * part of its input); these are only for the screen, and the text sent is never touched. Anything not listed
 * here (the older benchmark conditions, `Custom` players) falls back to the id and the rule the option
 * carries, so every player can be watched.
 */
export interface OptionLabel {
  glyph: string;
  /** A sentence-sized name, for the conversation. */
  label: string;
  /** One or two words, for the caption under the game. */
  short: string;
}

export interface QuestionLabel {
  title: string;
  /** In display order. */
  options: Readonly<Record<string, OptionLabel>>;
}

/** The lookups of the `route` strategy (ADR-0011): three always, and a fourth while the chicken stands on a platform. */
export const ROUTE_LABELS: Readonly<Record<string, QuestionLabel>> = {
  cell: {
    title: "Can it stand there?",
    options: {
      stand: { glyph: "✓", label: "Yes, it can land there", short: "Yes" },
      no_stand: { glyph: "✗", label: "No, it can't land there", short: "No" },
    },
  },
  moving: {
    title: "Does that row move?",
    options: {
      moving: { glyph: "↔", label: "Yes, things move", short: "Moves" },
      still: { glyph: "▪", label: "No, it stands still", short: "Still" },
    },
  },
  around: {
    title: "Which way round?",
    options: {
      detour_left: { glyph: "←", label: "Round on the left", short: "Left" },
      detour_right: { glyph: "→", label: "Round on the right", short: "Right" },
      wait_here: { glyph: "•", label: "Wait here", short: "Wait" },
    },
  },
  ride: {
    title: "Is its platform leaving the world?",
    options: {
      leaving: { glyph: "!", label: "Yes, the edge is a moment away", short: "Leave" },
      staying: { glyph: "✓", label: "No, it can stay on it", short: "Stay" },
    },
  },
};

/** The lookups every request of the route strategy carries; `ride` is only there while the chicken is on a platform. */
export const ALWAYS_ASKED = ["cell", "moving", "around"] as const;

const named = (glyph: string, label: string): OptionLabel => ({ glyph, label, short: label });

/** What each manoeuvre of the strategies with a controller is called. */
export const MANEUVER_LABELS: Readonly<Record<string, OptionLabel>> = {
  cross_ahead: named("↑", "Go straight"),
  detour_left: named("←", "Detour left"),
  detour_right: named("→", "Detour right"),
  sidestep_left: named("←", "Sidestep left"),
  sidestep_right: named("→", "Sidestep right"),
  back_off: named("↓", "Back off"),
  wait_here: named("•", "Wait here"),
  leave_platform: named("↓", "Get off the platform"),
};

const isAction = (id: string): id is Action => (ACTIONS as readonly string[]).includes(id);

const capitalized = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** `two_away` -> `two away`, for a word taken straight from the state. */
export const spoken = (word: string): string => word.replaceAll("_", " ");

/** Title of a question: ours when we know it, the id as a sentence otherwise. */
export function titleOf(questionId: string): string {
  return ROUTE_LABELS[questionId]?.title ?? capitalized(spoken(questionId));
}

/** Glyph and words for one option, from the table, the five moves, the manoeuvres, or the bare id. */
export function optionLabel(questionId: string, optionId: string): OptionLabel {
  const known = ROUTE_LABELS[questionId]?.options[optionId];
  if (known) return known;
  if (isAction(optionId)) return named(ACTION_GLYPH[optionId], capitalized(ACTION_LABEL[optionId]));
  const maneuver = MANEUVER_LABELS[optionId];
  if (maneuver) return maneuver;
  return named("", capitalized(spoken(optionId)));
}

/** What the model's decision comes to, in words: the manoeuvre it chose, or else the move itself. */
export function decisionLabel(maneuverId: string | undefined, action: Action): OptionLabel {
  // Getting off a platform is made of whichever hop gets the chicken off it, which is the one to draw.
  if (maneuverId === "leave_platform") {
    return { glyph: ACTION_GLYPH[action], label: "Get off the platform", short: "Get off" };
  }
  return (maneuverId ? MANEUVER_LABELS[maneuverId] : undefined) ?? optionLabel("", action);
}

/**
 * The options in the order a person reads them: the table's order for a question we know, the order of the
 * five moves for those, and the order the model was sent (sorted by id) for anything else.
 */
export function orderOptions(questionId: string, ids: readonly string[]): string[] {
  const known = ROUTE_LABELS[questionId];
  const rank = (id: string): number => {
    const index = known
      ? Object.keys(known.options).indexOf(id)
      : ACTION_ORDER.indexOf(id as Action);
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  };
  const allRanked = ids.every((id) => rank(id) !== Number.MAX_SAFE_INTEGER);
  return allRanked ? [...ids].sort((a, b) => rank(a) - rank(b)) : [...ids];
}

/** The value at a dotted path of the state, as text; undefined when it is not there. */
export function readPath(state: unknown, path: string): string | undefined {
  let at: unknown = state;
  for (const key of path.split(".")) {
    if (at === null || typeof at !== "object") return undefined;
    at = (at as Record<string, unknown>)[key];
  }
  return typeof at === "string" || typeof at === "number" || typeof at === "boolean"
    ? String(at)
    : undefined;
}

/** What lies on the cell ahead, as a coloured tile and a few words, for each word the scene view uses. */
const CELL_SCENE: Readonly<Record<string, { tile: string; phrase: string; moves: boolean }>> = {
  empty: { tile: "grass", phrase: "Open ground", moves: false },
  tree: { tile: "tree", phrase: "A tree in the way", moves: false },
  water: { tile: "water", phrase: "Water", moves: true },
  log: { tile: "log", phrase: "A log to stand on", moves: true },
  lily_pad: { tile: "lily", phrase: "A lily pad", moves: true },
  vehicle: { tile: "car", phrase: "A vehicle", moves: true },
  train: { tile: "train", phrase: "A train", moves: true },
  train_coming: { tile: "train", phrase: "A train is coming", moves: false },
  outside_world: { tile: "edge", phrase: "The edge of the world", moves: false },
  unseen: { tile: "edge", phrase: "Out of sight", moves: false },
};

const OPENING_WORDS: Readonly<Record<string, string>> = {
  adjacent: "next to it",
  two_away: "2 away",
  three_or_more: "3 or more",
  none: "none",
};

/** The clock of the platform the chicken stands on, as the model was told it. */
export interface PlatformView {
  phrase: string;
  /** How loud to say it: the edge is a moment away, coming up, a way off, or the platform is not taking it there. */
  urgency: "now" | "soon" | "later" | "none";
}

export interface SceneView {
  /** A CSS class for the tile: grass, tree, water, log, lily, car, train or edge. */
  tile: string;
  phrase: string;
  /** How far to the nearest opening on each side, as "left: 2 away". */
  gaps: string[];
  /** What the model was told of the platform under the chicken; null off a platform. */
  platform: PlatformView | null;
}

const PLATFORM_CLOCK: Readonly<Record<string, { says: string; urgency: PlatformView["urgency"] }>> =
  {
    a_moment: { says: "the edge of the world is a moment away", urgency: "now" },
    soon: { says: "the edge of the world is coming up", urgency: "soon" },
    later: { says: "the edge of the world is still a way off", urgency: "later" },
    not_carried: { says: "it is not taking the chicken to the edge", urgency: "none" },
  };

/** The platform line of the scene, from what the state says of the chicken. */
function platformOf(state: unknown): PlatformView | null {
  const clock = PLATFORM_CLOCK[readPath(state, "chicken.edge_in") ?? ""];
  if (!clock) return null;
  const toward = readPath(state, "chicken.carried_towards");
  const carried = toward === "left" || toward === "right" ? ` carried ${toward}` : "";
  return { phrase: `On a platform${carried}: ${clock.says}`, urgency: clock.urgency };
}

/**
 * The screen as the model was told it, in a sentence a person reads at a glance. Only the `scene` view of the
 * default gameplay has the fields this reads; for anything else there is no such sentence, and it is null.
 */
export function sceneOf(state: unknown): SceneView | null {
  const lands = readPath(state, "cross_ahead.lands_on");
  if (lands === undefined) return null;
  const cell = CELL_SCENE[lands] ?? { tile: "edge", phrase: spoken(lands), moves: false };
  const move = readPath(state, "cross_ahead.things_move");
  const motion = move === "left" || move === "right" ? `moving ${move}` : "standing still";
  const gaps = (["left", "right"] as const).flatMap((side): string[] => {
    const opening = readPath(state, `detour_${side}.opening_ahead`);
    return opening === undefined ? [] : [`${side}: ${OPENING_WORDS[opening] ?? spoken(opening)}`];
  });
  const moving = move === "left" || move === "right";
  // Something that is itself in motion (water, a vehicle) is told as it moves; ground that is empty
  // right now but whose row has things on it is told as "things moving".
  const phrase = cell.moves
    ? `${cell.phrase}, ${motion}`
    : moving
      ? `${cell.phrase}, things moving ${move}`
      : cell.phrase;
  return { tile: cell.tile, phrase, gaps, platform: platformOf(state) };
}
