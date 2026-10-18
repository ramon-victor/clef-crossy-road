import { type Action, MAX_ABS_X, type Observation, type ObsRow } from "@ccr/core";
import { HOP_SECONDS } from "./forecast.ts";
import {
  type Cell,
  canStand,
  cellWindow,
  hopWindow,
  isPermanent,
  lanesState,
  rowAt,
} from "./lanes.ts";
import { emptyMemory, type Memory } from "./memory.ts";
import type { ControllerManeuver, DecisionNotice } from "./notice.ts";
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
 * every hop, the way the Doom, Tetris and Minecraft projects leave the path to code. It gives the decision
 * back, with the reason, when it cannot go on.
 */
export const ROUTE_IDS = [
  "cross_ahead",
  "detour_left",
  "detour_right",
  "wait_here",
  "leave_platform",
] as const;
export type RouteManeuver = (typeof ROUTE_IDS)[number];

/** Each manoeuvre is reported on the move it is made of; `leave_platform` has none of its own, it is the hop the controller finds. */
export const ROUTE_ACTION: Readonly<Record<Exclude<RouteManeuver, "leave_platform">, Action>> = {
  cross_ahead: "hop_forward",
  detour_left: "hop_left",
  detour_right: "hop_right",
  wait_here: "stay",
};

/** Hops a detour may take before it gives the decision back. */
export const MAX_DETOUR_STEPS = 40;
export const DETOUR_DEPTH = 24;
export const EXIT_DEPTH = 8;
export const RETRY_AFTER = 4;
/** Steps a crossing waits for the cell ahead to clear: three seconds of game time. */
export const MAX_CROSS_WAIT = 15;
export const MAX_LEAVE_STEPS = 8;

const T = HOP_SECONDS;

const MOVES: ReadonlyArray<readonly [Action, number, number]> = [
  ["hop_forward", 1, 0],
  ["hop_left", 0, -1],
  ["hop_right", 0, 1],
  ["hop_back", -1, 0],
  ["stay", 0, 0],
];

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
  const { goalDz, side, col0, depth = DETOUR_DEPTH } = request;
  return walk(
    obs,
    depth,
    (node) => node.dz >= goalDz && (side === "left" ? node.c < col0 : node.c > col0),
    (node) => node.dz >= goalDz,
  );
}

interface WalkNode {
  dz: number;
  c: number;
  /** Speed of the platform under the chicken (columns per second). */
  v: number;
  /** Hops from now at which it lands. */
  d: number;
}

/** A cell for which `isDead` holds is reached but not walked on from (a detour that arrives on the wrong side is not that detour). */
function walk(
  obs: Observation,
  depth: number,
  isGoal: (node: WalkNode) => boolean,
  isDead: (node: WalkNode) => boolean = () => false,
): Route | null {
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
        const row = rowAt(obs, dz);
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
        const reached = { ...landed, d };
        if (isGoal(reached)) return { first: path[0] as Action, path };
        if (!isDead(reached)) next.push({ ...landed, path });
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
 * The shortest way off a platform that carries the chicken to the edge, onto a row ahead if there is one and only
 * then back: leaving by the way it came made it board the same log again and again (48.7 rows fell to 42.1 on
 * the free reference).
 */
export function searchExit(obs: Observation): Route | null {
  const settled = (node: WalkNode): boolean =>
    secondsToLimit(node.c, node.v, MAX_ABS_X - EDGE_MARGIN) >= EDGE_SOON &&
    canStand(cellWindow(rowAt(obs, node.dz), node.c, node.d * T, (node.d + 1) * T, true));
  return (
    walk(obs, EXIT_DEPTH, (node) => node.dz >= 1 && settled(node)) ?? walk(obs, EXIT_DEPTH, settled)
  );
}

export const HOLD_WHYS = ["refused", "unsafe_here", "edge", "no_way"] as const;
export type HoldWhy = (typeof HOLD_WHYS)[number];

/** `no_rest`: the cell is clear for the hop, but a vehicle or train would reach it before the chicken could go on. */
export type WaitWhy = "gap" | "no_rest";

/** What a step of the controller is, so that whoever shows it never reads the note. */
export type RouteStep =
  | { kind: "hop" }
  | { kind: "wait"; n: number; of: number; cell: string; why: WaitWhy }
  | { kind: "walk"; n: number; left: number }
  | { kind: "leave"; n: number; left: number }
  | { kind: "hold"; why: HoldWhy };

/** One step the controller takes: the move to make now, what it is doing in a sentence, and what kind of step it is. */
export interface RouteAct {
  action: Action;
  note: string;
  notice: DecisionNotice;
  step: RouteStep;
  refused?: boolean;
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

const legOf = (route: Route): string =>
  `${route.first.replace("hop_", "")} (${route.path.length} to go)`;

function legAct(
  name: ControllerManeuver,
  kind: "walk" | "leave",
  n: number,
  route: Route,
): RouteAct {
  return {
    action: route.first,
    note: `${name}: hop ${n}, ${legOf(route)}`,
    notice: {
      kind: "detour",
      maneuver: name,
      step: n,
      action: route.first,
      remaining: route.path.length,
    },
    step: { kind, n, left: route.path.length },
  };
}

/** A refusal never leaves the chicken standing where a vehicle is about to arrive: it steps off a cell it cannot stay on. */
function safeHold(obs: Observation, memory: Memory): RouteAct {
  const off = driftingOff(obs);
  if (off === "no" && canStand(lanesState(obs, memory).chicken.stays_on)) {
    return {
      action: "stay",
      note: "waiting where it is safe",
      notice: { kind: "safe_wait" },
      step: { kind: "hold", why: "refused" },
    };
  }
  const why = off === "no" ? "unsafe_here" : "edge";
  const away = (off === "no" ? null : searchExit(obs)) ?? searchEscape(obs);
  if (away) {
    return {
      action: away.first,
      note: `stepping off a cell it cannot stay on: ${legOf(away)}`,
      notice: { kind: "escape", action: away.first, remaining: away.path.length },
      step: { kind: "hold", why },
    };
  }
  return {
    action: "stay",
    note: "nowhere safe to step, waiting",
    notice: { kind: "blocked_wait" },
    step: { kind: "hold", why: "no_way" },
  };
}

const staysWater = (row: ObsRow | undefined, cell: Cell): boolean =>
  cell === "water" && row?.kind === "water" && row.platforms.every((p) => p.speed_cols_per_s === 0);

/** Stepping onto a road or rail that the chicken then has to wait on, with a vehicle or train about to arrive, is how the first games were lost. */
function canSettle(obs: Observation): boolean {
  if (canStand(hopWindow(rowAt(obs, 1), obs.player.col, T, 1.9, true))) return true;
  return canStand(cellWindow(rowAt(obs, 2), Math.round(obs.player.col), 2 * T, 2.5 * T));
}

function crossingCell(obs: Observation): { cell: Cell; noRest: boolean } {
  const landing = hopWindow(rowAt(obs, 1), obs.player.col, T, 1.5 * T);
  const noRest = canStand(landing) && !canSettle(obs);
  if (!noRest) return { cell: landing, noRest };
  return { cell: rowAt(obs, 1)?.kind === "rail" ? "train" : "vehicle", noRest };
}

/**
 * Holds the manoeuvre in progress between decisions. One per episode (a policy is created per episode).
 * Crossing waits for the cell ahead to clear and hops; a detour walks the route above; waiting is one step.
 */
export class RouteExecutor {
  private plan: CrossPlan | DetourPlan | LeavePlan | null = null;
  private last: string | undefined;
  private lastNotice: DecisionNotice | undefined;
  private readonly failedAt: Record<SideName, number | null> = { left: null, right: null };
  private failedAtScore = 0;

  /** How the last manoeuvre went, in a sentence, for the model's memory. */
  get lastResult(): string | undefined {
    return this.last;
  }

  failedSides(memory: Memory): Readonly<Record<SideName, boolean>> {
    if (memory.score > this.failedAtScore) {
      this.failedAt.left = null;
      this.failedAt.right = null;
    }
    const failed = (side: SideName): boolean => {
      const at = this.failedAt[side];
      return at !== null && at <= memory.sinceProgress && memory.sinceProgress - at < RETRY_AFTER;
    };
    return { left: failed("left"), right: failed("right") };
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
      this.lastNotice = { kind: "waited" };
      return this.hold(obs, memory);
    }
    if (maneuver === "cross_ahead") {
      const plan: CrossPlan = { kind: "cross", waited: 0 };
      this.plan = plan;
      return this.crossStep(plan, obs, memory, true) ?? this.refusal(obs, memory);
    }
    if (maneuver === "leave_platform") {
      const plan: LeavePlan = { kind: "leave", steps: 0 };
      this.plan = plan;
      return this.leaveStep(plan, obs, true) ?? this.refusal(obs, memory);
    }
    const plan: DetourPlan = {
      kind: "detour",
      side: maneuver === "detour_left" ? "left" : "right",
      col0: Math.round(obs.player.col),
      scoreAtStart: memory.score,
      steps: 0,
    };
    this.plan = plan;
    return this.detourStep(plan, obs, memory, true) ?? this.refusal(obs, memory);
  }

  private refusal(obs: Observation, memory: Memory): RouteAct {
    return { ...this.hold(obs, memory), refused: true };
  }

  /** A refused manoeuvre still costs the chicken a step: it waits, or steps off a cell that cannot hold it. */
  private hold(obs: Observation, memory: Memory): RouteAct {
    const held = safeHold(obs, memory);
    return {
      ...held,
      note: `${this.last ?? "hold"}; ${held.note}`,
      notice: {
        kind: "sequence",
        parts: this.lastNotice ? [this.lastNotice, held.notice] : [held.notice],
      },
    };
  }

  private giveBack(
    starting: boolean,
    name: ControllerManeuver,
    why: string,
    reason: DecisionNotice,
  ): null {
    this.lastNotice = { kind: starting ? "refused" : "returned", maneuver: name, reason };
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
    const { cell, noRest } = crossingCell(obs);
    const chicken = lanesState(obs, memory).chicken;
    if (canStand(cell)) {
      const after = plan.waited === 0 ? "" : ` after waiting ${plan.waited} step(s)`;
      this.last = `cross_ahead: hopped${after}`;
      this.lastNotice = { kind: "hopped", maneuver: "cross_ahead", count: plan.waited };
      this.plan = null;
      return {
        action: "hop_forward",
        note: "cross_ahead: the cell is clear, hopping",
        notice: { kind: "clear", maneuver: "cross_ahead" },
        step: { kind: "hop" },
      };
    }
    if (isPermanent(cell)) {
      return this.giveBack(starting, "cross_ahead", `${cell} does not go away`, {
        kind: "permanent",
        cell,
      });
    }
    if (!canStand(chicken.stays_on)) {
      const why = `the chicken cannot stay where it stands (${chicken.stays_on})`;
      return this.giveBack(starting, "cross_ahead", why, {
        kind: "cannot_stay",
        cell: chicken.stays_on,
      });
    }
    if (driftingOff(obs) !== "no") {
      return this.giveBack(
        starting,
        "cross_ahead",
        "a platform is carrying it past the edge of the world",
        { kind: "drift" },
      );
    }
    if (staysWater(rowAt(obs, 1), cell)) {
      return this.giveBack(starting, "cross_ahead", "nothing moves on that row, the water stays", {
        kind: "still_water",
      });
    }
    if (plan.waited >= MAX_CROSS_WAIT) {
      const why = `the cell (${cell}) did not clear in ${plan.waited} steps`;
      return this.giveBack(starting, "cross_ahead", why, {
        kind: "timeout",
        cell,
        count: plan.waited,
      });
    }
    plan.waited++;
    return {
      action: "stay",
      note: `cross_ahead: waiting for the cell (${cell}) to clear, ${plan.waited}/${MAX_CROSS_WAIT}`,
      notice: {
        kind: "waiting",
        maneuver: "cross_ahead",
        cell,
        waited: plan.waited,
        limit: MAX_CROSS_WAIT,
      },
      step: {
        kind: "wait",
        n: plan.waited,
        of: MAX_CROSS_WAIT,
        cell,
        why: noRest ? "no_rest" : "gap",
      },
    };
  }

  private leaveStep(plan: LeavePlan, obs: Observation, starting: boolean): RouteAct | null {
    if (secondsToEdge(obs) >= EDGE_SOON) {
      if (starting) {
        const why = "the chicken is not being carried towards the edge";
        return this.giveBack(true, "leave_platform", why, { kind: "not_carried" });
      }
      this.last = `leave_platform: off the platform's way after ${plan.steps} hop(s)`;
      this.plan = null;
      return null;
    }
    if (plan.steps >= MAX_LEAVE_STEPS) {
      const why = `more than ${MAX_LEAVE_STEPS} hops and still carried`;
      return this.giveBack(starting, "leave_platform", why, {
        kind: "still_carried",
        count: MAX_LEAVE_STEPS,
      });
    }
    const route = searchExit(obs);
    if (!route) {
      return this.giveBack(starting, "leave_platform", `no way off within ${EXIT_DEPTH} hops`, {
        kind: "no_exit",
        count: EXIT_DEPTH,
      });
    }
    return legAct("leave_platform", "leave", ++plan.steps, route);
  }

  private detourStep(
    plan: DetourPlan,
    obs: Observation,
    memory: Memory,
    starting: boolean,
  ): RouteAct | null {
    const name = plan.side === "left" ? "detour_left" : "detour_right";
    const fail = (why: string, reason: DecisionNotice): null => {
      this.failedAt[plan.side] = memory.sinceProgress;
      this.failedAtScore = memory.score;
      return this.giveBack(starting, name, why, reason);
    };
    if (memory.score > plan.scoreAtStart) {
      this.last = `${name}: reached a new row after ${plan.steps} hop(s)`;
      this.plan = null;
      return null;
    }
    if (plan.steps >= MAX_DETOUR_STEPS) {
      return fail(`more than ${MAX_DETOUR_STEPS} hops and no new row`, {
        kind: "too_long",
        count: MAX_DETOUR_STEPS,
      });
    }
    const route = searchRoute(obs, {
      goalDz: memory.behindFrontier + 1,
      side: plan.side,
      col0: plan.col0,
    });
    if (!route)
      return fail(`no way to an opening on the ${plan.side} within ${DETOUR_DEPTH} hops`, {
        kind: "no_route",
        side: plan.side,
        count: DETOUR_DEPTH,
      });
    return legAct(name, "walk", ++plan.steps, route);
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
  if (scene.chicken.edge_in === "a_moment") return "leave_platform";
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
          if (step)
            return {
              action: step.action,
              source: "executor",
              note: step.note,
              notice: step.notice,
            };
          const scene = sceneState(obs, memory, { failed: executor.failedSides(memory) });
          const first = executor.start(routeChoice(scene), obs, memory);
          return {
            action: first.action,
            source: "executor",
            note: first.note,
            notice: first.notice,
          };
        },
      };
      return policy;
    },
  };
})();
