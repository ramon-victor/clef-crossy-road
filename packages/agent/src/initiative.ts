import type { Decision } from "./policy.ts";

export type Initiative = "model" | "controller";

/**
 * Who made this move, for the screen and the reports. The move a consultation ends in is the model's, including
 * `step_off` and `leave_platform` (the model said the chicken goes; the controller only finds the hop). It is the
 * controller's when it ran on after an answer (`source: "executor"`), when the model's manoeuvre could not start and the
 * controller held the chicken, and when it began another manoeuvre than the one the model chose. A model's own `wait_here`
 * or `wait_gap` is a hold too, and stays the model's.
 */
export function decidedBy({ source, extra }: Pick<Decision, "source" | "extra">): Initiative {
  if (source === "executor") return "controller";
  if (extra?.fallback !== undefined) return "controller";
  const step = extra?.controller;
  const held = typeof step === "object" && step !== null && "kind" in step && step.kind === "hold";
  const waits = extra?.maneuver === "wait_here" || extra?.maneuver === "wait_gap";
  return held && !waits ? "controller" : "model";
}

/** The model timed the hop (`route-live`): the decision came from a strategy that asks again at every step. */
export const isLive = ({ extra }: Pick<Decision, "extra">): boolean => extra?.live === true;

/** A step the model itself spent waiting for a gap under `route-live`. */
export function isLiveWait(decision: Pick<Decision, "extra">): boolean {
  const step = decision.extra?.controller;
  return (
    isLive(decision) &&
    typeof step === "object" &&
    step !== null &&
    "kind" in step &&
    step.kind === "wait"
  );
}
