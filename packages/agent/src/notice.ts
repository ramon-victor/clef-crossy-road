import type { Action } from "@ccr/core";
import type { Maneuver } from "./executor.ts";
import type { Cell } from "./lanes.ts";
import type { RouteManeuver } from "./route.ts";

export type ControllerManeuver = Maneuver | RouteManeuver;

/** Presentation only. Never include these events in observations, prompts, memory or cache keys. */
export type DecisionNotice =
  | {
      kind:
        | "wait"
        | "safe_wait"
        | "blocked_wait"
        | "drift"
        | "waited"
        | "still_water"
        | "not_carried";
    }
  | { kind: "clear"; maneuver: ControllerManeuver }
  | { kind: "waiting"; maneuver: ControllerManeuver; cell: Cell; waited: number; limit: number }
  | { kind: "escape"; action: Action; remaining: number }
  | {
      kind: "detour";
      maneuver: ControllerManeuver;
      step: number;
      action: Action;
      remaining: number;
    }
  | { kind: "permanent" | "cannot_stay"; cell: Cell }
  | { kind: "timeout"; cell: Cell; count: number }
  | { kind: "too_long" | "still_carried" | "no_exit"; count: number }
  | { kind: "no_route"; side: "left" | "right"; count: number }
  | { kind: "refused" | "returned"; maneuver: ControllerManeuver; reason: DecisionNotice }
  | { kind: "hopped" | "reached"; maneuver: ControllerManeuver; count: number }
  | { kind: "sequence"; parts: readonly DecisionNotice[] }
  | { kind: "model"; maneuver: ControllerManeuver; step: DecisionNotice };
