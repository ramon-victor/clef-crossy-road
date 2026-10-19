import { type Action, Game, type Observation, type ObsRow } from "@ccr/core";
import { logAt, railRow, rowsGenerator, trainAt, waterRow } from "@ccr/core/testing";
import { emptyMemory, type Memory } from "./memory.ts";
import { type SceneState, sceneState } from "./scene.ts";

export const grass = (blocked: number[] = [], dz = 0): ObsRow => ({
  dz,
  kind: "grass",
  blocked_cols: blocked,
});
export const water = (
  platforms: Array<{ col: number; speed?: number; type?: "log" | "lily_pad"; half?: number }>,
  dz = 1,
): ObsRow => ({
  dz,
  kind: "water",
  platforms: platforms.map((p) => ({
    col: p.col,
    half_extent: p.half ?? 0.6,
    speed_cols_per_s: p.speed ?? 0,
    type: p.type ?? "lily_pad",
  })),
});
export const road = (vehicles: Array<{ col: number; speed: number }>, dz = 1): ObsRow => ({
  dz,
  kind: "road",
  vehicles: vehicles.map((v) => ({ col: v.col, half_extent: 1, speed_cols_per_s: v.speed })),
});
export const world = (rows: ObsRow[], col = 0, riding = false): Observation => ({
  player: {
    col,
    standing_on: rows.find((r) => r.dz === 0)?.kind ?? "grass",
    riding,
    hop_ticks_left: 0,
  },
  rows,
});

/** A chicken boxed in by trees on a grass row, with one lily pad two columns to the right on the water ahead. */
export const boxedIn = (): Observation =>
  world([grass([], -1), grass([-1, 1], 0), water([{ col: 2 }], 1), grass([], 2)]);

export const scene = (obs: Observation, memory: Memory = emptyMemory()): SceneState =>
  sceneState(obs, memory);

/** Recorded seed 6 prefix: row 17, on a left-moving log, with a warned rail behind it. */
export function seed6PlatformExit(): Game {
  const game = new Game({ seed: 6 });
  const actions: Action[] = [
    "hop_forward",
    "stay",
    "stay",
    "stay",
    "stay",
    "hop_forward",
    "hop_forward",
    "hop_forward",
    "hop_forward",
    "stay",
    "stay",
    "stay",
    "hop_forward",
    "hop_forward",
    "stay",
    "stay",
    "stay",
    "hop_forward",
    "hop_forward",
    "stay",
    "stay",
    "stay",
    "stay",
    "hop_back",
    "hop_forward",
  ];
  for (const action of actions) game.step(action);
  return game;
}

/** The exit from a drifting log crosses two warned rails before reaching the bank. */
export function warnedRailsExit(): Game {
  const game = new Game({
    seed: 1,
    generator: rowsGenerator({
      7: railRow(7, trainAt(110)),
      8: railRow(8, trainAt(110)),
      9: waterRow(9, [logAt(-0.6, -0.05, 3)], "logs"),
      10: waterRow(10, [], "lily_pads"),
    }),
  });
  for (const action of ["hop_right", "hop_right", "hop_right", "hop_forward"] as const) {
    game.step(action);
  }
  return game;
}
