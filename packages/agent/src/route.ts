import { type Action, MAX_ABS_X, type Observation, type ObsRow } from "@ccr/core";
import { columnAfter, HOP_SECONDS } from "./forecast.ts";
import { canStand, cellWindow, isPermanent, lanesState } from "./lanes.ts";
import { emptyMemory, type Memory } from "./memory.ts";
import type { Decision, ObservationPolicy, PolicyFactory } from "./policy.ts";
import { type SceneState, type SideName, sceneState } from "./scene.ts";

/**
 * Manoeuvres with a detour (ADR-0011). The model says WHAT to do about the row in front of it: cross,
 * go round by one side, or wait. The controller says HOW: for a detour it walks the way round (back one
 * row if it must, along the row, forward onto the first row not yet reached), checking the world at
 * every hop, the way the Doom, Tetris and Minecraft projects leave the path to code. It never swaps the
 * side the model chose, and gives the decision back, with the reason, when it cannot go on.
 */
export const ROUTE_IDS = ["cross_ahead", "detour_left", "detour_right", "wait_here"] as const;
export type RouteManeuver = (typeof ROUTE_IDS)[number];

/** Each manoeuvre is reported on the move it is made of, so the panel keeps its five bars. */
export const ROUTE_ACTION: Readonly<Record<RouteManeuver, Action>> = {
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
        if (!canStand(cellWindow(row, c, d * T, (d + 0.5) * T, move === "stay"))) continue;
        const key = `${dz},${Math.round(c * 2)},${d}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const path = [...node.path, move];
        const landed = { dz, c, v: platformSpeed(row, c, d * T) };
        if (isGoal(landed)) return { first: path[0] as Action, path };
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

/** How close to the edge of the world a route may bring the chicken: the game ends past 5 columns. */
const EDGE_MARGIN = 0.3;

/** The speed of the platform that would carry a chicken standing on `col` of `row` at `seconds` from now (0 if none). */
function platformSpeed(row: ObsRow | undefined, col: number, seconds: number): number {
  if (row?.kind !== "water") return 0;
  const platform = [...row.platforms]
    .reverse()
    .find((p) => Math.abs(col - columnAfter(p, seconds)) < p.half_extent);
  return platform?.speed_cols_per_s ?? 0;
}

/** The speed of the platform the chicken is riding now (0 when it is not on one). */
function ridingSpeed(obs: Observation): number {
  return obs.player.riding ? platformSpeed(rowOf(obs, 0), obs.player.col, 0) : 0;
}

/**
 * Which way a platform will carry the chicken past the edge of the world within a second if it stays on it,
 * or "no". A player sees the log drifting towards the end of the screen; waiting for a gap on it is how the
 * chicken is lost.
 */
export function driftingOff(obs: Observation): "left" | "right" | "no" {
  const future = obs.player.col + ridingSpeed(obs) * 1;
  if (future > MAX_ABS_X - EDGE_MARGIN) return "right";
  if (future < -(MAX_ABS_X - EDGE_MARGIN)) return "left";
  return "no";
}

/** One step the controller takes: the move to make now and, in a sentence, what it is doing. */
export interface RouteAct {
  action: Action;
  note: string;
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

/**
 * A hop that gets the chicken off a cell it cannot stay on, the safest one: forward, then to the side away
 * from the nearer edge, then the other side, then back. Only used when a manoeuvre is refused, so that a
 * refusal never leaves the chicken standing where a vehicle is about to arrive.
 */
function safeHold(obs: Observation, memory: Memory): RouteAct {
  const off = driftingOff(obs);
  if (off === "no" && canStand(lanesState(obs, memory).chicken.stays_on)) {
    return { action: "stay", note: "waiting where it is safe" };
  }
  const away = searchEscape(obs);
  if (away) {
    return {
      action: away.first,
      note: `stepping off a cell it cannot stay on: ${away.first.replace("hop_", "")} (${away.path.length} to go)`,
    };
  }
  return { action: "stay", note: "nowhere safe to step, waiting" };
}

/**
 * Whether the chicken, once it has hopped onto the row ahead, can stay there for the next three steps (0.6 s)
 * or go on to the row after: stepping onto a road or a rail track that it then has to wait on, with a vehicle
 * or a train about to arrive, is how the first games were lost. A player waits on the bank until both are clear.
 */
function canSettle(obs: Observation, col: number): boolean {
  const ahead = rowOf(obs, 1);
  if (canStand(cellWindow(ahead, col, T, 1.9, true))) return true;
  return canStand(cellWindow(rowOf(obs, 2), col, 2 * T, 2.5 * T));
}

/**
 * Holds the manoeuvre in progress between decisions. One per episode (a policy is created per episode).
 * Crossing waits for the cell ahead to clear and hops; a detour walks the route above; waiting is one step.
 */
export class RouteExecutor {
  private plan: CrossPlan | DetourPlan | null = null;
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
    return plan.kind === "detour"
      ? this.detourStep(plan, obs, memory, false)
      : this.crossStep(plan, obs, memory, false);
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
    return { action: held.action, note: `${this.last ?? "hold"}; ${held.note}` };
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
    const col = Math.round(obs.player.col);
    const landing = cellWindow(rowOf(obs, 1), col, T, 1.5 * T);
    // A cell that is clear for the hop is not enough: the chicken may have to wait there for the row after it.
    const cell = canStand(landing) && !canSettle(obs, col) ? "vehicle" : landing;
    const chicken = lanesState(obs, memory).chicken;
    if (canStand(cell)) {
      const after = plan.waited === 0 ? "" : ` after waiting ${plan.waited} step(s)`;
      this.last = `cross_ahead: hopped${after}`;
      this.plan = null;
      return { action: "hop_forward", note: "cross_ahead: the cell is clear, hopping" };
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
