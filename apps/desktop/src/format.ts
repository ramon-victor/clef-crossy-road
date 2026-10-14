import type { Action, DeathCause } from "@ccr/core";

export const ACTION_GLYPH: Readonly<Record<Action, string>> = {
  hop_forward: "↑",
  hop_back: "↓",
  hop_left: "←",
  hop_right: "→",
  stay: "•",
};

export const ACTION_LABEL: Readonly<Record<Action, string>> = {
  hop_forward: "forward",
  hop_back: "back",
  hop_left: "left",
  hop_right: "right",
  stay: "wait",
};

/** Display order in the panel: forward first, then sideways, wait, back. */
export const ACTION_ORDER: readonly Action[] = [
  "hop_forward",
  "hop_left",
  "hop_right",
  "stay",
  "hop_back",
];

export const DEATH_TEXT: Readonly<Record<DeathCause, string>> = {
  car: "Hit by a car",
  water: "Drowned",
  train: "Hit by a train",
  out_of_bounds: "Wandered off the road",
};

export const percent = (p: number | undefined): string =>
  p === undefined ? "–" : `${Math.round(p * 100)}%`;

export const ms = (v: number | null | undefined): string =>
  v === null || v === undefined ? "–" : `${Math.round(v)} ms`;

export type MeterLevel = "ok" | "high" | "full";

/** How alarming the neuron meter should look: high from 70% of the free tier, full once it is spent. */
export function meterLevel(spent: number, limit: number): MeterLevel {
  if (spent >= limit) return "full";
  return spent / limit > 0.7 ? "high" : "ok";
}
