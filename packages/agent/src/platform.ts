import { MAX_ABS_X, type Observation, type ObsRow } from "@ccr/core";
import { columnAfter } from "./forecast.ts";
import { rowAt } from "./lanes.ts";

/** The game ends past 5 columns; a route stays this far inside. */
export const EDGE_MARGIN = 0.3;

export const EDGE_A_MOMENT = 1;
export const EDGE_SOON = 2.5;

export type EdgeIn = "a_moment" | "soon" | "later" | "not_carried";

/** The speed of the platform that carries a chicken standing on `col` of `row` `seconds` from now (0 if none). */
export function platformSpeed(row: ObsRow | undefined, col: number, seconds: number): number {
  if (row?.kind !== "water") return 0;
  const platform = [...row.platforms]
    .reverse()
    .find((p) => Math.abs(col - columnAfter(p, seconds)) < p.half_extent);
  return platform?.speed_cols_per_s ?? 0;
}

export function ridingSpeed(obs: Observation): number {
  return obs.player.riding ? platformSpeed(rowAt(obs, 0), obs.player.col, 0) : 0;
}

/** Infinite when the platform stands still. */
export function secondsToLimit(col: number, speed: number, limit: number): number {
  if (speed === 0) return Number.POSITIVE_INFINITY;
  const edge = speed > 0 ? limit : -limit;
  return Math.max(0, (edge - col) / speed);
}

export function secondsToEdge(obs: Observation): number {
  return secondsToLimit(obs.player.col, ridingSpeed(obs), MAX_ABS_X);
}

export function edgeWord(seconds: number): EdgeIn {
  if (seconds === Number.POSITIVE_INFINITY) return "not_carried";
  return seconds < EDGE_A_MOMENT ? "a_moment" : seconds < EDGE_SOON ? "soon" : "later";
}

export interface PlatformClock {
  toward: "left" | "right";
  seconds: number;
  word: EdgeIn;
}

export function platformClock(obs: Observation): PlatformClock | null {
  const speed = ridingSpeed(obs);
  if (speed === 0) return null;
  const seconds = secondsToEdge(obs);
  return { toward: speed > 0 ? "right" : "left", seconds, word: edgeWord(seconds) };
}

export function driftingOff(obs: Observation): "left" | "right" | "no" {
  const speed = ridingSpeed(obs);
  if (secondsToLimit(obs.player.col, speed, MAX_ABS_X - EDGE_MARGIN) >= EDGE_A_MOMENT) return "no";
  return speed > 0 ? "right" : "left";
}
