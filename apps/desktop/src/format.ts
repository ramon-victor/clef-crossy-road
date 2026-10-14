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

export function randomSeed(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return (buffer[0] ?? 1) % 1_000_000; // short, easy to read and type
}
