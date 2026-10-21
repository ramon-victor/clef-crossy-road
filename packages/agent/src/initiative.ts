import type { Decision } from "./policy.ts";

export type Initiative = "model" | "controller";

/**
 * Who made this move, for the screen and the reports. The move a consultation ends in is the model's, including
 * `step_off` and `leave_platform` (the model said the chicken goes; the controller only finds the hop). It is the
 * controller's when it ran on after an answer (`source: "executor"`), when the model's manoeuvre could not start and the
 * controller held the chicken, and when it began another manoeuvre than the one the model chose. A model's own `wait_here`
 * is a hold too, and stays the model's.
 */
export function decidedBy({ source, extra }: Pick<Decision, "source" | "extra">): Initiative {
  if (source === "executor") return "controller";
  if (extra?.fallback !== undefined) return "controller";
  const step = extra?.controller;
  const held = typeof step === "object" && step !== null && "kind" in step && step.kind === "hold";
  return held && extra?.maneuver !== "wait_here" ? "controller" : "model";
}
