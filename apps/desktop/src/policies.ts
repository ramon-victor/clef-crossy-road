import {
  alwaysForward,
  clefPolicy,
  DEFAULT_CLEF,
  decisionCost,
  lookaheadPolicy,
  type PolicyFactory,
  randomPolicy,
} from "@ccr/agent";
import type { ClefClient } from "@ccr/clef";

export type ChoiceKind = "human" | "model" | "reference";

export interface PolicyChoice {
  id: string;
  label: string;
  detail: string;
  kind: ChoiceKind;
  /** True if a fresh decision may spend neurons (cache hits never do). */
  usesApi: boolean;
  /** Cost of an uncached decision, in neurons (from the tokens measured per decision, see AGENTS.md). */
  neuronsPerDecision?: number;
  /**
   * Seeds whose decisions are already in the cache for this player (from the benchmark runs), so
   * replaying them spends nothing. Any other seed asks the model and spends neurons.
   */
  freeReplay?: string;
  factory: PolicyFactory | null;
}

/** Parses a `freeReplay` range such as "1-100" into its bounds. */
export function freeSeedRange(
  choice: PolicyChoice | undefined,
): { min: number; max: number } | null {
  const match = /^(\d+)-(\d+)$/.exec(choice?.freeReplay ?? "");
  if (!match) return null;
  const [min, max] = [Number(match[1]), Number(match[2])];
  return max >= min ? { min, max } : null;
}

/**
 * The map "New map" should open. A model player first walks through the seeds that are already cached
 * (free), so pressing the key keeps costing nothing; once those are used up it falls back to a random seed.
 */
export function nextMapSeed(
  choice: PolicyChoice | undefined,
  lastFreeSeed: number | undefined,
  random: () => number,
): { seed: number; free: boolean } {
  const range = freeSeedRange(choice);
  if (range) {
    const next = lastFreeSeed === undefined ? range.min : lastFreeSeed + 1;
    if (next <= range.max) return { seed: next, free: true };
  }
  return { seed: random(), free: false };
}

/** The id of the one model player, which is what `CCR_PLAYER` and `?player=` select. */
export const CLEF_ID = "clef";

const HUMAN: PolicyChoice = {
  id: "human",
  label: "You",
  detail: "Arrow keys or WASD",
  kind: "human",
  usesApi: false,
  factory: null,
};

const REFERENCES: readonly PolicyChoice[] = [
  {
    id: "lookahead",
    label: "Look-ahead (reference)",
    detail: "Reads the simulator and searches 4 hops ahead. A ceiling, not a model",
    kind: "reference",
    usesApi: false,
    factory: lookaheadPolicy(),
  },
  {
    id: "always-forward",
    label: "Always forward (baseline)",
    detail: "The honest floor: about 4 rows on average",
    kind: "reference",
    usesApi: false,
    factory: alwaysForward,
  },
  {
    id: "random",
    label: "Random (baseline)",
    detail: "Uniform over the five actions",
    kind: "reference",
    usesApi: false,
    factory: randomPolicy,
  },
];

/**
 * The model player. There is one on purpose: JSON, grid, critic and the 27B were conditions of the
 * benchmark, and none played better than "always forward" (docs/07). The seeds in `freeReplay` are
 * the ones whose decisions that benchmark left in the cache.
 */
function clefChoice(client: ClefClient | null): PolicyChoice {
  return {
    id: CLEF_ID,
    label: "Clef-flash",
    detail:
      "Cloudflare's 9B decision model picks every move. In our tests it plays about like 'always forward' (3.7 rows)",
    kind: "model",
    usesApi: true,
    neuronsPerDecision: decisionCost(DEFAULT_CLEF).neurons,
    freeReplay: "1-100",
    factory: client ? clefPolicy(client, DEFAULT_CLEF) : null,
  };
}

export function buildPolicyChoices(client: ClefClient | null): PolicyChoice[] {
  return [HUMAN, clefChoice(client), ...REFERENCES];
}
