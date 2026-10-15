import { MAX_ABS_X, type Observation, type ObsMover, type ObsRow, type RowKind } from "@ccr/core";
import { columnAfter, HOP_SECONDS } from "./forecast.ts";
import { emptyMemory, type Memory } from "./memory.ts";
import { outcomeText } from "./view.ts";

/**
 * The `lanes` view (ADR-0010): the world already compared, in words. The model is weak at arithmetic
 * and at comparing magnitudes (the notes of the model it shares with the other Jev games, and our own
 * probes), so the code does the subtraction and reports what fills each cell, in a closed vocabulary
 * with no digits. It says what is THERE when the hop ends; it never says what that means for the
 * chicken. Nothing here depends on a candidate move except which cell is named.
 */
export const CELL_WORDS = [
  "empty",
  "tree",
  "water",
  "log",
  "lily_pad",
  "vehicle",
  "train",
  "train_coming",
  "outside_world",
  "unseen",
] as const;
export type Cell = (typeof CELL_WORDS)[number];

/** The only cells a chicken can end a hop on and stay alive. A rule of the game, not a reading of a state. */
export const STANDABLE: readonly Cell[] = ["empty", "log", "lily_pad"];
export const canStand = (cell: Cell): boolean => STANDABLE.includes(cell);

/** A cell that does not change by waiting: a tree stays, the edge of the world stays. */
export const isPermanent = (cell: Cell): boolean => cell === "tree" || cell === "outside_world";

/** How many hops ahead the second glance looks (a sideways hop first, then the hop forward). */
const LATER = 2 * HOP_SECONDS;

const covers = (mover: ObsMover, col: number, seconds: number): boolean =>
  Math.abs(col - columnAfter(mover, seconds)) < mover.half_extent;

/** A hop is over a road row from about its middle, so a vehicle counts if it covers the cell at any point after that. */
const sweep = (seconds: number): number[] => [seconds / 2, (seconds * 3) / 4, seconds];

/**
 * What fills `col` of `row` when the chicken would be there `seconds` from now, if every moving thing
 * keeps its speed. The same for any candidate move and any chicken position.
 */
export function cellAt(row: ObsRow | undefined, col: number, seconds: number): Cell {
  if (Math.abs(col) > MAX_ABS_X) return "outside_world";
  if (!row) return "unseen";
  switch (row.kind) {
    case "grass":
      return row.blocked_cols.includes(Math.trunc(col)) ? "tree" : "empty";
    case "road":
      return sweep(seconds).some((t) => row.vehicles.some((v) => covers(v, col, t)))
        ? "vehicle"
        : "empty";
    case "water": {
      // Upstream lets the last overlapping platform win.
      const platform = [...row.platforms].reverse().find((p) => covers(p, col, seconds));
      return platform ? platform.type : "water";
    }
    case "rail":
      if (covers(row.train, col, seconds)) return "train";
      return row.warning_light === "on" ? "train_coming" : "empty";
  }
}

const rowAt = (obs: Observation, dz: number): ObsRow | undefined =>
  obs.rows.find((row) => row.dz === dz);

type Side = "left" | "right" | "no";

/** Which way the things in a row move on the screen. */
function thingsMove(row: ObsRow | undefined): Side {
  if (!row) return "no";
  const first: ObsMover | undefined =
    row.kind === "road"
      ? row.vehicles[0]
      : row.kind === "water"
        ? row.platforms[0]
        : row.kind === "rail"
          ? row.train
          : undefined;
  if (!first || first.speed_cols_per_s === 0) return "no";
  return first.speed_cols_per_s > 0 ? "right" : "left";
}

/** Where the chicken stands in the width of the world, in words. */
export type Place = "at_left_edge" | "left" | "middle" | "right" | "at_right_edge";

export function placeOf(col: number): Place {
  if (col <= -4) return "at_left_edge";
  if (col < -2) return "left";
  if (col < 2) return "middle";
  if (col < 4) return "right";
  return "at_right_edge";
}

function carriedTowards(obs: Observation): Side {
  if (!obs.player.riding) return "no";
  const own = rowAt(obs, 0);
  if (own?.kind !== "water") return "no";
  const platform = own.platforms.find((p) => covers(p, obs.player.col, 0));
  if (!platform || platform.speed_cols_per_s === 0) return "no";
  return platform.speed_cols_per_s > 0 ? "right" : "left";
}

export interface LanesState {
  chicken: {
    standing_on: RowKind;
    on_a_platform: boolean;
    carried_towards: Side;
    place_in_world: Place;
    /** What is under it when this hop ends, if it stays. */
    stays_on: Cell;
  };
  forward: {
    row: RowKind | "unseen";
    things_move: Side;
    /** Where it lands if it hops forward now. */
    lands_on: Cell;
    /** Where a hop forward lands one hop later, after stepping to the side first. */
    lands_on_after_stepping_left: Cell;
    lands_on_after_stepping_right: Cell;
  };
  sideways: { left_lands_on: Cell; right_lands_on: Cell };
  backward: { row: RowKind | "unseen"; lands_on: Cell };
  rows_further_ahead: RowKind[];
  memory: {
    last_moves: string[];
    blocked_last_two: boolean;
    no_new_row_for_a_while: boolean;
    /** How the last manoeuvre went (manoeuvre strategy only). */
    last_maneuver?: string;
  };
}

/** Moves of the memory the state lists. */
export const LANES_MEMORY_MOVES = 4;

/** Decisions without a new row after which the memory says so. */
export const WHILE_WITHOUT_ROW = 4;

function memoryWords(memory: Memory, lastManeuver?: string): LanesState["memory"] {
  const lastTwo = memory.recent.slice(-2);
  return {
    last_moves: memory.recent
      .slice(-LANES_MEMORY_MOVES)
      .map((move) => `${move.action}: ${outcomeText(move.outcome)}`),
    blocked_last_two: lastTwo.length === 2 && lastTwo.every((move) => move.outcome === "blocked"),
    no_new_row_for_a_while: memory.sinceProgress >= WHILE_WITHOUT_ROW,
    ...(lastManeuver === undefined ? {} : { last_maneuver: lastManeuver }),
  };
}

/** The state of the `lanes` view: the observation and the memory, compared and put in words. */
export function lanesState(
  obs: Observation,
  memory: Memory = emptyMemory(),
  lastManeuver?: string,
): LanesState {
  const col = obs.player.col;
  const here = rowAt(obs, 0);
  const ahead = rowAt(obs, 1);
  const behind = rowAt(obs, -1);
  const straight = Math.round(col);
  const riding = obs.player.riding;
  return {
    chicken: {
      standing_on: obs.player.standing_on,
      on_a_platform: riding,
      carried_towards: carriedTowards(obs),
      place_in_world: placeOf(col),
      // A platform carries the chicken along, so on one it stays on that platform.
      stays_on:
        riding && here?.kind === "water"
          ? (here.platforms.find((p) => covers(p, col, 0))?.type ?? cellAt(here, col, HOP_SECONDS))
          : cellAt(here, col, HOP_SECONDS),
    },
    forward: {
      row: ahead?.kind ?? "unseen",
      things_move: thingsMove(ahead),
      lands_on: cellAt(ahead, straight, HOP_SECONDS),
      lands_on_after_stepping_left: cellAt(ahead, Math.round(col - 1), LATER),
      lands_on_after_stepping_right: cellAt(ahead, Math.round(col + 1), LATER),
    },
    sideways: {
      left_lands_on: cellAt(here, col - 1, HOP_SECONDS),
      right_lands_on: cellAt(here, col + 1, HOP_SECONDS),
    },
    backward: { row: behind?.kind ?? "unseen", lands_on: cellAt(behind, straight, HOP_SECONDS) },
    rows_further_ahead: [2, 3, 4]
      .map((dz) => rowAt(obs, dz)?.kind)
      .filter((kind): kind is RowKind => kind !== undefined),
    memory: memoryWords(memory, lastManeuver),
  };
}
