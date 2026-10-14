import type { MoverKind } from "./mover.ts";

/** The five actions a policy can take. Names are model-facing option IDs (see docs/05). */
export type Action = "hop_forward" | "hop_back" | "hop_left" | "hop_right" | "stay";

export const ACTIONS: readonly Action[] = [
  "hop_forward",
  "hop_back",
  "hop_left",
  "hop_right",
  "stay",
];

export type DeathCause = "car" | "water" | "train" | "out_of_bounds";

/** What `act` did with the requested action. */
export type MoveOutcome = "hop" | "blocked" | "stay" | "ignored";

export interface StepResult {
  readonly outcome: MoveOutcome;
  readonly alive: boolean;
  readonly deathCause: DeathCause | null;
  readonly score: number;
  readonly ticksAdvanced: number;
}

export interface MoverSnapshot {
  readonly kind: MoverKind;
  readonly variant: number;
  readonly width: number;
  readonly halfExtent: number;
  /** Current column, in upstream's x axis (+x is screen-left). */
  readonly x: number;
  /** Tiles per tick, signed, in upstream's x axis. */
  readonly speed: number;
}

export type RowSnapshot =
  | { readonly kind: "grass"; readonly z: number; readonly blocked: readonly number[] }
  | { readonly kind: "road"; readonly z: number; readonly movers: readonly MoverSnapshot[] }
  | {
      readonly kind: "water";
      readonly z: number;
      readonly flavor: "lily_pads" | "logs";
      readonly movers: readonly MoverSnapshot[];
    }
  | {
      readonly kind: "rail";
      readonly z: number;
      readonly movers: readonly MoverSnapshot[];
      readonly lightOn: boolean;
    };

/** Everything a renderer or a hash needs. Plain data, no references into the simulation. */
export interface Snapshot {
  readonly seed: number;
  readonly tick: number;
  readonly alive: boolean;
  readonly deathCause: DeathCause | null;
  readonly score: number;
  readonly invalidMoves: number;
  readonly hero: {
    readonly x: number;
    readonly z: number;
    readonly moving: boolean;
    readonly hopTick: number;
    readonly fromX: number;
    readonly fromZ: number;
    readonly targetX: number;
    readonly targetZ: number;
    readonly ridingOn: { readonly z: number; readonly index: number } | null;
  };
  readonly rows: readonly RowSnapshot[];
}

export interface SnapshotWindow {
  /** Rows to include behind the hero's current row. */
  readonly behind?: number;
  /** Rows to include ahead of it. */
  readonly ahead?: number;
}
