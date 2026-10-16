import { type Action, MAX_ABS_X, type Observation } from "@ccr/core";
import { HOP_SECONDS } from "./forecast.ts";
import { canStand, cellWindow, hopWindow, isPermanent, lanesState } from "./lanes.ts";
import { emptyMemory, type Memory } from "./memory.ts";
import {
  driftingOff,
  EDGE_MARGIN,
  EDGE_SOON,
  platformSpeed,
  ridingSpeed,
  secondsToEdge,
  secondsToLimit,
} from "./platform.ts";
import type { Decision, ObservationPolicy, PolicyFactory } from "./policy.ts";
import { type SceneState, type SideName, sceneState } from "./scene.ts";

/**
 * Manoeuvres with a detour (ADR-0011). The model says WHAT to do about the row in front of it: cross,
 * go round by one side, or wait. The controller says HOW: for a detour it walks the way round (back one
 * row if it must, along the row, forward onto the first row not yet reached), checking the world at
 * every hop, the way the Doom, Tetris and Minecraft projects leave the path to code. It never swaps the
 * side the model chose, and gives the decision back, with the reason, when it cannot go on.
 */
export const ROUTE_IDS = [
  "cross_ahead",
  "detour_left",
  "detour_right",
  "wait_here",
  "leave_platform",
] as const;
export type RouteManeuver = (typeof ROUTE_IDS)[number];

/** The manoeuvre the model gets for a platform that is carrying the chicken to the edge of the world. */
export const LEAVE: RouteManeuver = "leave_platform";

/**
 * Each manoeuvre is reported on the move it is made of, so the panel keeps its five bars. `leave_platform` has none
 * of its own: it is made of whichever hop gets the chicken off, which the controller finds when it starts.
 */
export const ROUTE_ACTION: Readonly<Record<Exclude<RouteManeuver, "leave_platform">, Action>> = {
  cross_ahead: "hop_forward",
  detour_left: "hop_left",
  detour_right: "hop_right",
  wait_here: "stay",
};

/** Hops a detour may take before it gives the decision back. */
export const MAX_DETOUR_STEPS = 12;
/** How many hops the route search looks ahead. */
export const ROUTE_DEPTH = 8;
/** Steps a crossing waits for the cell ahead to clear: three seconds of game time. */
export const MAX_CROSS_WAIT = 15;
/** Hops a way off a platform may take before it gives the decision back. */
export const MAX_LEAVE_STEPS = 8;

const T = HOP_SECONDS;

const MOVES: ReadonlyArray<readonly [Action, number, number]> = [
  ["hop_forward", 1, 0],
  ["hop_left", 0, -1],
  ["hop_right", 0, 1],
  ["hop_back", -1, 0],
  ["stay", 0, 0],
];

const rowOf = (obs: Observation, dz: number) => obs.rows.find((row) => row.dz === dz);

export interface RouteRequest {
  /** The row to get to, as rows ahead of the chicken's own: the first one it has not reached yet. */
  goalDz: number;
  side: SideName;
  /** The column the chicken started the detour from: the end of the route is to its `side`. */
  col0: number;
  depth?: number;
}

export interface Route {
  /** The first hop, which is the one to make now. */
  first: Action;
  path: Action[];
}

/**
 * The shortest way, over the words alone (what fills each cell when a hop lands on it, hop by hop), to a cell
 * of the goal row on the chosen side of where the chicken stands. Breadth first, one 0.2 s hop per level, waiting
 * allowed. Each hop is checked in its own window (`cellWindow`), so a vehicle that arrives during the next
 * hop counts. It looks at no simulator: only the observation.
 */
export function searchRoute(obs: Observation, request: RouteRequest): Route | null {
  const { goalDz, side, col0, depth = ROUTE_DEPTH } = request;
  return walk(
    obs,
    depth,
    (node) => node.dz >= goalDz && (side === "left" ? node.c < col0 : node.c > col0),
  );
}

interface WalkNode {
  dz: number;
  c: number;
  /** Speed of the platform under the chicken (columns per second). */
  v: number;
  /** The hop it is reached on, counting from 1: it lands `d` hops (0.2 s each) from now. */
  d: number;
}

/** The shortest way to any cell the goal accepts, one hop of 0.2 s per level. */
function walk(obs: Observation, depth: number, isGoal: (node: WalkNode) => boolean): Route | null {
  // `v` is the speed (columns per second) of the platform the chicken stands on, which carries it while it waits.
  let level: Array<{ dz: number; c: number; v: number; path: Action[] }> = [
    { dz: 0, c: obs.player.col, v: ridingSpeed(obs), path: [] },
  ];
  const seen = new Set<string>();
  for (let d = 1; d <= depth; d++) {
    const next: typeof level = [];
    for (const node of level) {
      for (const [move, ddz, dc] of MOVES) {
        const dz = node.dz + ddz;
        // A forward or backward hop lands on the nearest whole column, a side hop one column over, and a
        // chicken that waits on a platform is carried along (the same rules as the game).
        const c =
          move === "stay" ? node.c + node.v * T : ddz === 0 ? node.c + dc : Math.round(node.c);
        if (Math.abs(c) > MAX_ABS_X - EDGE_MARGIN || dz < -3 || dz > 8) continue;
        const row = rowOf(obs, dz);
        // A hop forward or back leaves a platform from a fractional column, so it is checked on the way to the whole one.
        const cell =
          ddz === 0
            ? cellWindow(row, c, d * T, (d + 0.5) * T, move === "stay")
            : hopWindow(row, node.c, d * T, (d + 0.5) * T);
        if (!canStand(cell)) continue;
        const key = `${dz},${Math.round(c * 2)},${d}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const path = [...node.path, move];
        const landed = { dz, c, v: platformSpeed(row, c, d * T) };
        if (isGoal({ ...landed, d })) return { first: path[0] as Action, path };
        next.push({ ...landed, path });
      }
    }
    level = next;
  }
  return null;
}

/** The shortest way to a cell where the chicken can stay without a platform carrying it off, within four hops. */
export function searchEscape(obs: Observation): Route | null {
  return walk(obs, 4, (node) => Math.abs(node.c + node.v) <= MAX_ABS_X - EDGE_MARGIN);
}

/**
 * The shortest way off a platform that carries the chicken to the edge: to a cell it can stay on for another
 * half second where nothing carries it to the edge within `EDGE_SOON` seconds (the next row, a platform that
 * stands still or goes the other way). A way on, to a row ahead of the one it stands on, is looked for first,
 * and only then a way back: leaving by the way it came made it board the same log again and leave it again,
 * over and over (measured on the free reference, 2026-10-15: 48.7 rows fell to 42.1).
 */
export function searchExit(obs: Observation): Route | null {
  const settled = (node: WalkNode): boolean =>
    secondsToLimit(node.c, node.v, MAX_ABS_X - EDGE_MARGIN) >= EDGE_SOON &&
    canStand(cellWindow(rowOf(obs, node.dz), node.c, node.d * T, (node.d + 1) * T, true));
  // On, to a row ahead of the one the chicken stands on, if there is a way; only then back to where it came from.
  return (
    walk(obs, ROUTE_DEPTH, (node) => node.dz >= 1 && settled(node)) ??
    walk(obs, ROUTE_DEPTH, settled)
  );
}

/**
 * What a step of the controller is, for whoever shows it: the sentence in `note` is for reading, this is for
 * telling the steps apart without parsing it.
 *  - `hop`:  the crossing the model chose, made now.
 *  - `wait`: standing until the cell ahead clears (`n` of at most `of` steps; `cell` is what is there). `why` is
 *    `gap` when the cell itself is not clear, `no_rest` when it is clear but a vehicle or train would reach it
 *    before the chicken could go on.
 *  - `walk`: one hop of a detour (`n` hops so far, `left` still to go).
 *  - `leave`: one hop of the way off a platform that carries the chicken to the edge (`n`, `left` as in `walk`).
 *  - `hold`: the manoeuvre was refused, so the chicken waits where it is safe or steps off a cell it cannot stay on.
 *    `why` says what stopped it: `refused` (the manoeuvre cannot begin, the chicken stays where it is safe),
 *    `unsafe_here` (it steps off a cell a vehicle or train is about to reach), `edge` (a platform is carrying it
 *    to the edge of the world, so it steps off) or `no_way` (there is nowhere safe to step).
 */
export type HoldWhy = "refused" | "unsafe_here" | "edge" | "no_way";

export type RouteStep =
  | { kind: "hop" }
  | { kind: "wait"; n: number; of: number; cell: string; why: "gap" | "no_rest" }
  | { kind: "walk"; n: number; left: number }
  | { kind: "leave"; n: number; left: number }
  | { kind: "hold"; why: HoldWhy };

/** One step the controller takes: the move to make now, in a sentence what it is doing, and what kind of step it is. */
export interface RouteAct {
  action: Action;
  note: string;
  step: RouteStep;
}

interface DetourPlan {
  kind: "detour";
  side: SideName;
  col0: number;
  scoreAtStart: number;
  steps: number;
}

interface CrossPlan {
  kind: "cross";
  waited: number;
}

interface LeavePlan {
  kind: "leave";
  steps: number;
}

/**
 * A hop that gets the chicken off a cell it cannot stay on, the safest one: forward, then to the side away
 * from the nearer edge, then the other side, then back. Only used when a manoeuvre is refused, so that a
 * refusal never leaves the chicken standing where a vehicle is about to arrive.
 */
function safeHold(obs: Observation, memory: Memory): RouteAct {
  const off = driftingOff(obs);
  if (off === "no" && canStand(lanesState(obs, memory).chicken.stays_on)) {
    return {
      action: "stay",
      note: "waiting where it is safe",
      step: { kind: "hold", why: "refused" },
    };
  }
  const why = off === "no" ? "unsafe_here" : "edge";
  const away = (off === "no" ? null : searchExit(obs)) ?? searchEscape(obs);
  if (away) {
    return {
      action: away.first,
      note: `stepping off a cell it cannot stay on: ${away.first.replace("hop_", "")} (${away.path.length} to go)`,
      step: { kind: "hold", why },
    };
  }
  return {
    action: "stay",
    note: "nowhere safe to step, waiting",
    step: { kind: "hold", why: "no_way" },
  };
}

/**
 * Whether the chicken, once it has hopped onto the row ahead, can stay there for the next three steps (0.6 s)
 * or go on to the row after: stepping onto a road or a rail track that it then has to wait on, with a vehicle
 * or a train about to arrive, is how the first games were lost. A player waits on the bank until both are clear.
 */
function canSettle(obs: Observation): boolean {
  const ahead = rowOf(obs, 1);
  if (canStand(hopWindow(ahead, obs.player.col, T, 1.9, true))) return true;
  return canStand(cellWindow(rowOf(obs, 2), Math.round(obs.player.col), 2 * T, 2.5 * T));
}

/**
 * Holds the manoeuvre in progress between decisions. One per episode (a policy is created per episode).
 * Crossing waits for the cell ahead to clear and hops; a detour walks the route above; waiting is one step.
 */
export class RouteExecutor {
  private plan: CrossPlan | DetourPlan | LeavePlan | null = null;
  private last: string | undefined;
  private readonly failed: Record<SideName, boolean> = { left: false, right: false };
  private failedAtScore = 0;

  /** How the last manoeuvre went, in a sentence, for the model's memory. */
  get lastResult(): string | undefined {
    return this.last;
  }

  /** Sides whose detour was refused or given back since the last new row. */
  failedSides(memory: Memory): Readonly<Record<SideName, boolean>> {
    if (memory.score > this.failedAtScore) {
      this.failed.left = false;
      this.failed.right = false;
    }
    return this.failed;
  }

  /** The step of the manoeuvre in progress, or null when there is none or it gave the decision back. */
  next(obs: Observation, memory: Memory): RouteAct | null {
    const plan = this.plan;
    if (!plan) return null;
    if (plan.kind === "detour") return this.detourStep(plan, obs, memory, false);
    if (plan.kind === "leave") return this.leaveStep(plan, obs, false);
    return this.crossStep(plan, obs, memory, false);
  }

  /** Starts the manoeuvre the model chose. One that cannot begin makes the chicken hold a step and the model hears why. */
  start(maneuver: RouteManeuver, obs: Observation, memory: Memory): RouteAct {
    this.plan = null;
    if (maneuver === "wait_here") {
      this.last = "wait_here: waited";
      return this.hold(obs, memory);
    }
    if (maneuver === "cross_ahead") {
      const plan: CrossPlan = { kind: "cross", waited: 0 };
      this.plan = plan;
      return this.crossStep(plan, obs, memory, true) ?? this.hold(obs, memory);
    }
    if (maneuver === "leave_platform") {
      const plan: LeavePlan = { kind: "leave", steps: 0 };
      this.plan = plan;
      return this.leaveStep(plan, obs, true) ?? this.hold(obs, memory);
    }
    const plan: DetourPlan = {
      kind: "detour",
      side: maneuver === "detour_left" ? "left" : "right",
      col0: Math.round(obs.player.col),
      scoreAtStart: memory.score,
      steps: 0,
    };
    this.plan = plan;
    return this.detourStep(plan, obs, memory, true) ?? this.hold(obs, memory);
  }

  /** A refused manoeuvre still costs the chicken a step: it waits, or steps off a cell that cannot hold it. */
  private hold(obs: Observation, memory: Memory): RouteAct {
    const held = safeHold(obs, memory);
    return { action: held.action, note: `${this.last ?? "hold"}; ${held.note}`, step: held.step };
  }

  private giveBack(starting: boolean, name: string, why: string): null {
    this.last = `${name}: ${starting ? "refused" : "given back"}, ${why}`;
    this.plan = null;
    return null;
  }

  private crossStep(
    plan: CrossPlan,
    obs: Observation,
    memory: Memory,
    starting: boolean,
  ): RouteAct | null {
    const landing = hopWindow(rowOf(obs, 1), obs.player.col, T, 1.5 * T);
    // A cell that is clear for the hop is not enough: the chicken may have to wait there for the row after it,
    // and what stops it there is the vehicle or the train that would reach the cell, so that is what is named.
    const noRest = canStand(landing) && !canSettle(obs);
    const cell = noRest ? (rowOf(obs, 1)?.kind === "rail" ? "train" : "vehicle") : landing;
    const chicken = lanesState(obs, memory).chicken;
    if (canStand(cell)) {
      const after = plan.waited === 0 ? "" : ` after waiting ${plan.waited} step(s)`;
      this.last = `cross_ahead: hopped${after}`;
      this.plan = null;
      return {
        action: "hop_forward",
        note: "cross_ahead: the cell is clear, hopping",
        step: { kind: "hop" },
      };
    }
    if (isPermanent(cell))
      return this.giveBack(starting, "cross_ahead", `${cell} does not go away`);
    if (!canStand(chicken.stays_on)) {
      const why = `the chicken cannot stay where it stands (${chicken.stays_on})`;
      return this.giveBack(starting, "cross_ahead", why);
    }
    if (driftingOff(obs) !== "no") {
      return this.giveBack(
        starting,
        "cross_ahead",
        "a platform is carrying it past the edge of the world",
      );
    }
    if (plan.waited >= MAX_CROSS_WAIT) {
      const why = `the cell (${cell}) did not clear in ${plan.waited} steps`;
      return this.giveBack(starting, "cross_ahead", why);
    }
    plan.waited++;
    return {
      action: "stay",
      note: `cross_ahead: waiting for the cell (${cell}) to clear, ${plan.waited}/${MAX_CROSS_WAIT}`,
      step: {
        kind: "wait",
        n: plan.waited,
        of: MAX_CROSS_WAIT,
        cell,
        why: noRest ? "no_rest" : "gap",
      },
    };
  }

  /** One hop of the way off a platform that carries the chicken to the edge of the world. */
  private leaveStep(plan: LeavePlan, obs: Observation, starting: boolean): RouteAct | null {
    if (secondsToEdge(obs) >= EDGE_SOON) {
      if (starting) {
        const why = "the chicken is not being carried towards the edge";
        return this.giveBack(true, "leave_platform", why);
      }
      this.last = `leave_platform: off the platform's way after ${plan.steps} hop(s)`;
      this.plan = null;
      return null;
    }
    if (plan.steps >= MAX_LEAVE_STEPS) {
      const why = `more than ${MAX_LEAVE_STEPS} hops and still carried`;
      return this.giveBack(starting, "leave_platform", why);
    }
    const route = searchExit(obs);
    if (!route) {
      return this.giveBack(starting, "leave_platform", `no way off within ${ROUTE_DEPTH} hops`);
    }
    plan.steps++;
    return {
      action: route.first,
      note: `leave_platform: hop ${plan.steps}, ${route.first.replace("hop_", "")} (${route.path.length} to go)`,
      step: { kind: "leave", n: plan.steps, left: route.path.length },
    };
  }

  private detourStep(
    plan: DetourPlan,
    obs: Observation,
    memory: Memory,
    starting: boolean,
  ): RouteAct | null {
    const name = plan.side === "left" ? "detour_left" : "detour_right";
    const fail = (why: string): null => {
      this.failed[plan.side] = true;
      this.failedAtScore = memory.score;
      return this.giveBack(starting, name, why);
    };
    if (memory.score > plan.scoreAtStart) {
      this.last = `${name}: reached a new row after ${plan.steps} hop(s)`;
      this.plan = null;
      return null;
    }
    if (plan.steps >= MAX_DETOUR_STEPS) {
      return fail(`more than ${MAX_DETOUR_STEPS} hops and no new row`);
    }
    const route = searchRoute(obs, {
      goalDz: memory.behindFrontier + 1,
      side: plan.side,
      col0: plan.col0,
    });
    if (!route) return fail(`no way to an opening on the ${plan.side} within ${ROUTE_DEPTH} hops`);
    plan.steps++;
    return {
      action: route.first,
      note: `${name}: hop ${plan.steps}, ${route.first.replace("hop_", "")} (${route.path.length} to go)`,
      step: { kind: "walk", n: plan.steps, left: route.path.length },
    };
  }
}

const RANK: Readonly<Record<string, number>> = {
  adjacent: 1,
  two_away: 2,
  three_or_more: 3,
  none: 4,
};

/**
 * The manoeuvre the `lookup` options describe, picked by code: cross when the row ahead is open or
 * things are passing, otherwise round by the side with the nearer opening (the one away from the
 * nearer edge when they are as near), and wait when neither side has an opening or both were tried.
 * The ideal follower of those options, never a model.
 */
export function routeChoice(scene: SceneState): RouteManeuver {
  const clock = scene.chicken.edge_in;
  if (clock === "a_moment") return "leave_platform";
  const ahead = scene.cross_ahead;
  if (canStand(ahead.lands_on)) return "cross_ahead";
  if (!isPermanent(ahead.lands_on) && ahead.things_move !== "still") return "cross_ahead";
  const rank = (entry: SceneState["detour_left"]): number =>
    entry.recently_failed === "yes" ? 4 : (RANK[entry.opening_ahead] ?? 4);
  const [left, right] = [rank(scene.detour_left), rank(scene.detour_right)];
  if (left === 4 && right === 4) return "wait_here";
  if (left !== right) return left < right ? "detour_left" : "detour_right";
  const place = scene.chicken.place_in_world;
  return place === "at_left_edge" || place === "left" ? "detour_right" : "detour_left";
}

/** A player with no model: the ideal chooser plus the route controller. Free, a reference. */
export const execRoute: PolicyFactory = (() => {
  const id = "exec-route";
  return {
    id,
    create: () => {
      const executor = new RouteExecutor();
      const policy: ObservationPolicy = {
        kind: "observation",
        id,
        async decide(obs: Observation, memory: Memory = emptyMemory()): Promise<Decision> {
          const step = executor.next(obs, memory);
          if (step) return { action: step.action, source: "executor", note: step.note };
          const scene = sceneState(obs, memory, { failed: executor.failedSides(memory) });
          const first = executor.start(routeChoice(scene), obs, memory);
          return { action: first.action, source: "executor", note: first.note };
        },
      };
      return policy;
    },
  };
})();
