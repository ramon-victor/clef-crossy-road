import { MAX_ABS_X, TICKS_PER_SECOND } from "./constants.ts";
import type { Game } from "./game.ts";
import { type Mover, moverX, trainLightOn } from "./mover.ts";
import type { RowKind, RowSpec } from "./worldgen.ts";

/**
 * What an agent is allowed to see (docs/adr/0005 "fairness rule").
 *
 * Only measured physical facts: terrain, positions, hit-zone half-widths, velocities and the
 * signal phase. Nothing here depends on the candidate actions: no "safe/unsafe" flags, no list
 * of legal moves, no time-to-collision with the player.
 *
 * Axis convention for agents: `col` grows towards the screen's RIGHT (upstream's x is negated),
 * `dz` is the row offset from the player's row and grows forward. Speeds are in columns/second.
 */
export interface ObsMover {
  col: number;
  /** The player's centre is hit/carried when |player.col - col| < half_extent. */
  half_extent: number;
  speed_cols_per_s: number;
}

export interface ObsPlatform extends ObsMover {
  type: "log" | "lily_pad";
}

export type ObsRow =
  | { dz: number; kind: "grass"; blocked_cols: number[] }
  | { dz: number; kind: "road"; vehicles: ObsMover[] }
  | { dz: number; kind: "water"; platforms: ObsPlatform[] }
  | { dz: number; kind: "rail"; train: ObsMover; warning_light: "on" | "off" };

export interface Observation {
  player: {
    col: number;
    standing_on: RowKind;
    riding: boolean;
    hop_ticks_left: number;
  };
  rows: ObsRow[];
}

export interface ObserveWindow {
  behind?: number;
  ahead?: number;
}

/** Closed key sets. A test pins these so nothing derived from the actions can sneak in. */
export const OBSERVATION_KEYS = {
  observation: ["player", "rows"],
  player: ["col", "standing_on", "riding", "hop_ticks_left"],
  grass: ["dz", "kind", "blocked_cols"],
  road: ["dz", "kind", "vehicles"],
  water: ["dz", "kind", "platforms"],
  rail: ["dz", "kind", "train", "warning_light"],
  mover: ["col", "half_extent", "speed_cols_per_s"],
  platform: ["col", "half_extent", "speed_cols_per_s", "type"],
} as const;

const r2 = (v: number): number => {
  const rounded = Math.round(v * 100) / 100;
  return rounded === 0 ? 0 : rounded; // never emit -0
};
const r3 = (v: number): number => {
  const rounded = Math.round(v * 1000) / 1000;
  return rounded === 0 ? 0 : rounded;
};

const toCol = (x: number): number => r2(-x);
const toColsPerSecond = (speedPerTick: number): number => r2(-speedPerTick * TICKS_PER_SECOND);

function obsMover(m: Mover, tick: number): ObsMover {
  return {
    col: toCol(moverX(m, tick)),
    half_extent: r3(m.halfExtent),
    speed_cols_per_s: toColsPerSecond(m.speed),
  };
}

function obsRow(row: RowSpec, dz: number, tick: number): ObsRow {
  switch (row.kind) {
    case "grass":
      return {
        dz,
        kind: "grass",
        blocked_cols: row.blocked
          .map((x) => (x === 0 ? 0 : -x))
          .filter((c) => Math.abs(c) <= MAX_ABS_X)
          .sort((a, b) => a - b),
      };
    case "road":
      return {
        dz,
        kind: "road",
        vehicles: row.cars.map((c) => obsMover(c, tick)).sort((a, b) => a.col - b.col),
      };
    case "water":
      return {
        dz,
        kind: "water",
        platforms: row.items
          .map((p): ObsPlatform => ({ ...obsMover(p, tick), type: p.kind as "log" | "lily_pad" }))
          .sort((a, b) => a.col - b.col),
      };
    case "rail":
      return {
        dz,
        kind: "rail",
        train: obsMover(row.train, tick),
        warning_light: trainLightOn(row.train, tick) ? "on" : "off",
      };
  }
}

export function observe(game: Game, view: ObserveWindow = {}): Observation {
  const behind = view.behind ?? 3;
  const ahead = view.ahead ?? 8;
  const here = game.heroRow;
  const rows: ObsRow[] = [];
  for (let dz = -behind; dz <= ahead; dz++) {
    const row = game.row(here + dz);
    if (row) rows.push(obsRow(row, dz, game.tick));
  }
  const current = game.row(here);
  return {
    player: {
      col: toCol(game.heroX),
      standing_on: current ? current.kind : "grass",
      riding: game.heroRiding,
      hop_ticks_left: game.heroHopTicksLeft,
    },
    rows,
  };
}
