import type { Action, Observation } from "@ccr/core";
import { canStand, isPermanent, type LanesState, lanesState } from "./lanes.ts";
import type { Memory } from "./memory.ts";
import type { Decision, ObservationPolicy, PolicyFactory } from "./policy.ts";

/**
 * Manoeuvres and their executor (ADR-0010). The model says WHAT to do about the row in front of it; the
 * code says WHEN, reading the world live at every step, the way the Dino, Tetris and Doom players of
 * the other Jev projects split the work ("choose only the manoeuvre, the controller handles the
 * timing"). The executor never swaps the manoeuvre for another one: it either carries it out or gives
 * the decision back to the model and says why.
 */
export const MANEUVER_IDS = [
  "cross_ahead",
  "sidestep_left",
  "sidestep_right",
  "back_off",
  "wait_here",
] as const;
export type Maneuver = (typeof MANEUVER_IDS)[number];

/** Each manoeuvre is reported as the move it is made of, so the panel and the probes keep their five bars. */
export const MANEUVER_ACTION: Readonly<Record<Maneuver, Action>> = {
  cross_ahead: "hop_forward",
  sidestep_left: "hop_left",
  sidestep_right: "hop_right",
  back_off: "hop_back",
  wait_here: "stay",
};

/** How long a manoeuvre waits for its cell to clear: 15 steps of 0.2 s, three seconds of game time. */
export const MAX_WAIT_STEPS = 15;

export interface Plan {
  maneuver: Maneuver;
  /** Steps spent waiting so far. */
  waited: number;
}

/** One step of a manoeuvre: the move to make now, and how the manoeuvre stands afterwards. */
export interface Act {
  action: Action;
  /** The plan to carry on with, or null when the manoeuvre is over. */
  plan: Plan | null;
  /** In a sentence, for the log and the inspector. */
  note: string;
  /** Set when the manoeuvre ends with this step: how it went, for the model's memory. */
  result?: string;
}

export type Step = ({ kind: "act" } & Act) | { kind: "handback"; why: string };

const HOP_OF: Readonly<Record<Exclude<Maneuver, "wait_here">, Action>> = {
  cross_ahead: "hop_forward",
  sidestep_left: "hop_left",
  sidestep_right: "hop_right",
  back_off: "hop_back",
};

function targetOf(maneuver: Exclude<Maneuver, "wait_here">, state: LanesState) {
  switch (maneuver) {
    case "cross_ahead":
      return state.forward.lands_on;
    case "sidestep_left":
      return state.sideways.left_lands_on;
    case "sidestep_right":
      return state.sideways.right_lands_on;
    case "back_off":
      return state.backward.lands_on;
  }
}

/** Carried towards the edge it would fall off: waiting is no longer an option. */
function swept(state: LanesState): boolean {
  const { carried_towards, place_in_world } = state.chicken;
  return (
    (carried_towards === "left" && place_in_world === "at_left_edge") ||
    (carried_towards === "right" && place_in_world === "at_right_edge")
  );
}

/** What the manoeuvre does this step, reading the world as it is right now. Pure. */
export function stepPlan(plan: Plan, state: LanesState): Step {
  const { maneuver } = plan;
  if (maneuver === "wait_here") {
    return { kind: "act", action: "stay", plan: null, note: "waiting one step", result: "waited" };
  }
  const cell = targetOf(maneuver, state);
  if (canStand(cell)) {
    const after = plan.waited === 0 ? "" : ` after waiting ${plan.waited} step(s)`;
    return {
      kind: "act",
      action: HOP_OF[maneuver],
      plan: null,
      note: `${maneuver}: the cell is clear, hopping`,
      result: `${maneuver}: hopped${after}`,
    };
  }
  if (isPermanent(cell)) return { kind: "handback", why: `${cell} does not go away` };
  if (!canStand(state.chicken.stays_on)) {
    return {
      kind: "handback",
      why: `the chicken cannot stay where it stands (${state.chicken.stays_on})`,
    };
  }
  if (swept(state)) return { kind: "handback", why: "a platform is carrying it to the edge" };
  if (plan.waited >= MAX_WAIT_STEPS) {
    return { kind: "handback", why: `the cell (${cell}) did not clear in ${plan.waited} steps` };
  }
  const waited = plan.waited + 1;
  return {
    kind: "act",
    action: "stay",
    plan: { maneuver, waited },
    note: `${maneuver}: waiting for the cell (${cell}) to clear, ${waited}/${MAX_WAIT_STEPS}`,
  };
}

/**
 * Holds the manoeuvre in progress between decisions. One per episode (a policy is created per
 * episode), so it needs no reset.
 */
export class Executor {
  private plan: Plan | null = null;
  private last: string | undefined;

  /** How the last manoeuvre went, in a sentence, for the model's memory. */
  get lastResult(): string | undefined {
    return this.last;
  }

  /** The step of the manoeuvre in progress, or null when there is none or it gave the decision back. */
  next(state: LanesState): Act | null {
    if (!this.plan) return null;
    const step = stepPlan(this.plan, state);
    if (step.kind === "handback") {
      this.last = `${this.plan.maneuver}: given back, ${step.why}`;
      this.plan = null;
      return null;
    }
    return this.accept(step);
  }

  /** Starts the manoeuvre the model chose. If it cannot even begin, the chicken waits one step and the model hears why. */
  start(maneuver: Maneuver, state: LanesState): Act {
    const step = stepPlan({ maneuver, waited: 0 }, state);
    if (step.kind === "handback") {
      this.plan = null;
      this.last = `${maneuver}: refused, ${step.why}`;
      return { action: "stay", plan: null, note: `${maneuver}: refused, ${step.why}` };
    }
    return this.accept(step);
  }

  private accept(act: Act): Act {
    this.plan = act.plan;
    if (act.result) this.last = act.result;
    return act;
  }
}

/** A scripted way of picking the manoeuvre, to measure what the executor does without a model. */
export type Chooser = (state: LanesState) => Maneuver;

/** Always goes straight ahead: the executor on its own. A floor, never a model. */
export const alwaysCross: Chooser = () => "cross_ahead";

/**
 * The manoeuvre the `rules` manual describes, picked by code: cross when the way ahead is or will be
 * open, step to the side from which it is, leave a spot that cannot be stood on, otherwise wait. The
 * ideal follower of the manoeuvre rules, never a model.
 */
export const maneuverByRules: Chooser = (state) => {
  const { forward, sideways, backward, chicken } = state;
  const ahead = forward.lands_on;
  const willOpen = !isPermanent(ahead) && (canStand(ahead) || forward.things_move !== "no");
  if (willOpen) return "cross_ahead";

  const left = canStand(sideways.left_lands_on) && canStand(forward.lands_on_after_stepping_left);
  const right =
    canStand(sideways.right_lands_on) && canStand(forward.lands_on_after_stepping_right);
  if (left && right) {
    return chicken.place_in_world === "at_left_edge" || chicken.place_in_world === "left"
      ? "sidestep_right"
      : "sidestep_left";
  }
  if (left) return "sidestep_left";
  if (right) return "sidestep_right";

  if (!canStand(chicken.stays_on)) {
    if (canStand(sideways.left_lands_on)) return "sidestep_left";
    if (canStand(sideways.right_lands_on)) return "sidestep_right";
    if (canStand(backward.lands_on)) return "back_off";
  }
  return "wait_here";
};

/** A player with no model: a scripted chooser plus the executor. Free, for references. */
export function executorPolicy(id: string, choose: Chooser): PolicyFactory {
  return {
    id,
    create: () => {
      const executor = new Executor();
      const policy: ObservationPolicy = {
        kind: "observation",
        id,
        async decide(obs: Observation, memory?: Memory): Promise<Decision> {
          const state = lanesState(obs, memory);
          const act = executor.next(state) ?? executor.start(choose(state), state);
          return { action: act.action, source: "executor", note: act.note };
        },
      };
      return policy;
    },
  };
}

export const execCross = executorPolicy("exec-cross", alwaysCross);
export const execRules = executorPolicy("exec-rules", maneuverByRules);
