import { MAX_ABS_X, type Observation, type ObsRow } from "@ccr/core";
import { columnAfter } from "./forecast.ts";

/**
 * The clock of the platform under the chicken (ADR-0009, addendum): a log or a lily pad carries the chicken along
 * while it stands there, and the game ends when it is carried past the edge of the world. How soon that happens is
 * the platform's speed and its distance from the edge, both on the screen, the same whatever the chicken does next.
 */

/** How close to the edge of the world a route may bring the chicken: the game ends past 5 columns. */
export const EDGE_MARGIN = 0.3;

/** Seconds below which the edge is "a moment" away: about five hops. */
export const EDGE_A_MOMENT = 1;
/** Seconds below which it is "soon": the time to find a way off and hop there. */
export const EDGE_SOON = 2.5;

export const EDGE_WORDS = ["a_moment", "soon", "later", "not_carried"] as const;
export type EdgeIn = (typeof EDGE_WORDS)[number];

const rowOf = (obs: Observation, dz: number) => obs.rows.find((row) => row.dz === dz);

/** The speed of the platform that would carry a chicken standing on `col` of `row` at `seconds` from now (0 if none). */
export function platformSpeed(row: ObsRow | undefined, col: number, seconds: number): number {
  if (row?.kind !== "water") return 0;
  const platform = [...row.platforms]
    .reverse()
    .find((p) => Math.abs(col - columnAfter(p, seconds)) < p.half_extent);
  return platform?.speed_cols_per_s ?? 0;
}

/** The speed of the platform the chicken is riding now (0 when it is not on one). */
export function ridingSpeed(obs: Observation): number {
  return obs.player.riding ? platformSpeed(rowOf(obs, 0), obs.player.col, 0) : 0;
}

/** Seconds until a chicken at `col` on a platform of speed `speed` is carried past `limit` columns; infinite if it is not carried towards one. */
export function secondsToLimit(col: number, speed: number, limit: number): number {
  if (speed === 0) return Number.POSITIVE_INFINITY;
  const edge = speed > 0 ? limit : -limit;
  return Math.max(0, (edge - col) / speed);
}

/**
 * Seconds until the platform the chicken rides carries it past the edge of the world; infinite when it is not
 * on one, or the platform stands still.
 */
export function secondsToEdge(obs: Observation): number {
  return secondsToLimit(obs.player.col, ridingSpeed(obs), MAX_ABS_X);
}

/** The clock in a word: nothing is said of what to do about it. */
export function edgeWord(seconds: number): EdgeIn {
  if (seconds === Number.POSITIVE_INFINITY) return "not_carried";
  return seconds < EDGE_A_MOMENT ? "a_moment" : seconds < EDGE_SOON ? "soon" : "later";
}

/**
 * Which way a platform will carry the chicken past the edge of the world within a second if it stays on it,
 * or "no". A player sees the log drifting towards the end of the screen; waiting for a gap on it is how the
 * chicken is lost.
 */
export function driftingOff(obs: Observation): "left" | "right" | "no" {
  const speed = ridingSpeed(obs);
  if (secondsToLimit(obs.player.col, speed, MAX_ABS_X - EDGE_MARGIN) >= EDGE_A_MOMENT) return "no";
  return speed > 0 ? "right" : "left";
}
