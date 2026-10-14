import {
  ACTIONS,
  type Action,
  createRng,
  DECISION_TICKS,
  type Game,
  START_ROW,
  TICKS_PER_SECOND,
} from "@ccr/core";
import type { ObservationPolicy, OraclePolicy, PolicyFactory } from "./policy.ts";

/** Order used to break ties between equally good actions: progress first, retreat last. */
export const ACTION_PREFERENCE: readonly Action[] = [
  "hop_forward",
  "hop_left",
  "hop_right",
  "stay",
  "hop_back",
];

/** The honest floor: in the original rules the first rows are grass, so this pays without thinking. */
export const alwaysForward: PolicyFactory = {
  id: "always-forward",
  create: (): ObservationPolicy => ({
    kind: "observation",
    id: "always-forward",
    decide: async () => ({ action: "hop_forward" }),
  }),
};

export const randomPolicy: PolicyFactory = {
  id: "random",
  create(seed): ObservationPolicy {
    const rng = createRng(seed, 0, 0x52414e44); // dedicated domain: independent of the map
    return {
      kind: "observation",
      id: "random",
      decide: async () => ({ action: ACTIONS[rng.int(ACTIONS.length)] as Action }),
    };
  },
};

const DEATH = -1000;

/**
 * Exhaustive look-ahead over `depth` decisions using a copy of the real simulator. Because the
 * simulator is deterministic, this is exact within its horizon. It is a reference ceiling, not a
 * contender: it reads the simulator directly, which the fairness rule forbids for models.
 */
export function lookaheadPolicy(
  depth = 4,
  decisionTicks = DECISION_TICKS,
  compensateMs = 0,
): PolicyFactory {
  const id =
    compensateMs > 0
      ? `lookahead-comp:${compensateMs}`
      : depth === 4
        ? "lookahead"
        : `lookahead-${depth}`;
  const compensate = Math.round((compensateMs * TICKS_PER_SECOND) / 1000);
  return {
    id,
    create: (): OraclePolicy => ({
      kind: "oracle",
      id,
      decide: async (game) => {
        // Latency compensation: the action will land `compensate` ticks from now, so plan from the
        // world as it will be then (the hero stays put while it waits).
        let from = game;
        if (compensate > 0) {
          from = game.clone();
          from.advance(compensate);
        }
        return { action: bestAction(from, depth, decisionTicks) };
      },
    }),
  };
}

function bestAction(game: Game, depth: number, ticks: number): Action {
  let best: Action = "stay"; // never blocked, so at least one candidate always survives the filter
  let bestValue = Number.NEGATIVE_INFINITY;
  for (const action of ACTION_PREFERENCE) {
    const next = game.clone();
    // A blocked hop leaves the hero in place, exactly like `stay`; skip it so ties do not waste
    // decisions bumping into trees.
    if (next.step(action, ticks).outcome === "blocked") continue;
    const value = searchValue(next, depth - 1, ticks);
    if (value > bestValue) {
      bestValue = value;
      best = action;
    }
  }
  return best;
}

function searchValue(game: Game, remaining: number, ticks: number): number {
  // Dying earlier is worse than dying later.
  if (!game.alive) return DEATH - 100 * remaining;
  if (remaining === 0) return game.score * 10 + (game.heroRow - START_ROW);
  let best = Number.NEGATIVE_INFINITY;
  for (const action of ACTION_PREFERENCE) {
    const next = game.clone();
    if (next.step(action, ticks).outcome === "blocked") continue;
    best = Math.max(best, searchValue(next, remaining - 1, ticks));
  }
  return best;
}
