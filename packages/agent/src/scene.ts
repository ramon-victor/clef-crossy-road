import { MAX_ABS_X, type Observation } from "@ccr/core";
import { HOP_SECONDS } from "./forecast.ts";
import { canStand, cellWindow, hopWindow, type LanesState, lanesState, rowAt } from "./lanes.ts";
import type { Memory } from "./memory.ts";
import { type EdgeIn, edgeWord, secondsToEdge } from "./platform.ts";

/**
 * The `scene` view (ADR-0011): `lanes` widened to the whole row. The code looks along the row ahead and
 * along the chicken's own row and says, in a closed vocabulary with no digits, where the cells that a hop
 * could end on are. It reports what is there; it never says that a way is "reachable" or "safe" (the
 * controller finds the way, the model only picks a side, ADR-0009 and ADR-0010).
 */
export const DISTANCE_WORDS = ["adjacent", "two_away", "three_or_more", "none"] as const;
export type Distance = (typeof DISTANCE_WORDS)[number];

export const OWN_ROW_WORDS = ["blocked_at_once", "free_for_one", "free_for_two_or_more"] as const;
export type OwnRow = (typeof OWN_ROW_WORDS)[number];

export type BehindFrontier = "no" | "one" | "two_or_more";

export type SideName = "left" | "right";
export const sign = (side: SideName): -1 | 1 => (side === "left" ? -1 : 1);

const T = HOP_SECONDS;

const distanceWord = (steps: number): Distance =>
  steps === 1 ? "adjacent" : steps === 2 ? "two_away" : "three_or_more";

/**
 * How far to a side lies the nearest cell of the row ahead where a hop could end: `d` hops along the
 * chicken's row and then the hop forward, so it lands `d + 1` hops from now.
 */
export function openingAhead(obs: Observation, side: SideName): Distance {
  const col = Math.round(obs.player.col);
  const ahead = rowAt(obs, 1);
  for (let d = 1; d <= 2 * MAX_ABS_X; d++) {
    const c = col + sign(side) * d;
    if (Math.abs(c) > MAX_ABS_X) break;
    if (canStand(cellWindow(ahead, c, (d + 1) * T, (d + 1.5) * T))) return distanceWord(d);
  }
  return "none";
}

/** How many of the cells of the chicken's own row to a side could be stood on, one hop after another (up to two). */
export function ownRowThatWay(obs: Observation, side: SideName): OwnRow {
  const col = Math.round(obs.player.col);
  const here = rowAt(obs, 0);
  let free = 0;
  for (let k = 1; k <= 2; k++) {
    const c = col + sign(side) * k;
    if (Math.abs(c) > MAX_ABS_X || !canStand(cellWindow(here, c, k * T, (k + 0.5) * T))) break;
    free++;
  }
  return free === 0 ? "blocked_at_once" : free === 1 ? "free_for_one" : "free_for_two_or_more";
}

export const behindWord = (rows: number): BehindFrontier =>
  rows <= 0 ? "no" : rows === 1 ? "one" : "two_or_more";

/** What the code learned from the controller's last tries, for the state (the memory of a player who just bumped into a wall). */
export interface SceneContext {
  /** How the previous manoeuvre went. */
  lastManeuver?: string | undefined;
  /** Sides whose detour the controller refused or gave back since the last new row. */
  failed?: Readonly<Record<SideName, boolean>>;
}

export interface SceneState {
  cross_ahead: {
    lands_on: LanesState["forward"]["lands_on"];
    /** The way the things of that row move on the screen; `still` when they do not (the word `no` was read as "passing"). */
    things_move: "left" | "right" | "still";
  };
  detour_left: SceneSide;
  detour_right: SceneSide;
  wait_here: { stands_on: LanesState["chicken"]["stays_on"] };
  chicken: {
    place_in_world: LanesState["chicken"]["place_in_world"];
    carried_towards: LanesState["chicken"]["carried_towards"];
    behind_frontier: BehindFrontier;
    /** Only on a platform, so every other request stays as it was (ADR-0009, addendum). */
    edge_in?: EdgeIn;
  };
  memory: LanesState["memory"];
}

export interface SceneSide {
  opening_ahead: Distance;
  own_row_that_way: OwnRow;
  recently_failed: "yes" | "no";
}

/** The state of the `scene` view, keyed by the names of the manoeuvres whose options read it. */
export function sceneState(
  obs: Observation,
  memory: Memory,
  { lastManeuver, failed }: SceneContext = {},
): SceneState {
  const lanes = lanesState(obs, memory, lastManeuver);
  const side = (name: SideName): SceneSide => ({
    opening_ahead: openingAhead(obs, name),
    own_row_that_way: ownRowThatWay(obs, name),
    recently_failed: failed?.[name] ? "yes" : "no",
  });
  return {
    // The window of the hop and of the half hop that leaves the row again, as a route is checked.
    cross_ahead: {
      lands_on: hopWindow(rowAt(obs, 1), obs.player.col, T, 1.5 * T),
      things_move: lanes.forward.things_move === "no" ? "still" : lanes.forward.things_move,
    },
    detour_left: side("left"),
    detour_right: side("right"),
    wait_here: { stands_on: lanes.chicken.stays_on },
    chicken: {
      place_in_world: lanes.chicken.place_in_world,
      carried_towards: lanes.chicken.carried_towards,
      behind_frontier: behindWord(memory.behindFrontier),
      ...(obs.player.riding ? { edge_in: edgeWord(secondsToEdge(obs)) } : {}),
    },
    memory: lanes.memory,
  };
}
