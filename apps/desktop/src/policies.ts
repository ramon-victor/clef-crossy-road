import {
  alwaysForward,
  type ClefPolicyConfig,
  clefPolicy,
  clefPolicyId,
  DEFAULT_CLEF,
  decisionCost,
  lookaheadPolicy,
  type PolicyFactory,
  parseClefPolicyId,
  randomPolicy,
} from "@ccr/agent";
import type { ClefClient } from "@ccr/clef";

export type ChoiceKind = "human" | "model" | "reference";

export interface PolicyChoice {
  id: string;
  presentation:
    | "human"
    | "lookahead"
    | "always-forward"
    | "random"
    | "clef-flash"
    | "clef-27b"
    | "custom";
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

/** The ids of the two model players, which is what `CCR_PLAYER` and `?player=` select. */
export const CLEF_ID = "clef-flash";
export const CLEF_27B_ID = "clef-27b";

/**
 * The same gameplay for the bigger model (the scene view, the three lookups and the route controller of
 * ADR-0011), so the only thing that changes is the model. `DEFAULT_CLEF` is Clef-flash's.
 */
export const CLEF_27B_CONFIG: ClefPolicyConfig = { ...DEFAULT_CLEF, model: "clef" };

/**
 * Seeds whose decisions the benchmark left in the cache for Clef-flash's exact requests, so replaying them
 * costs nothing. A game only replays if the controller makes the same moves it made when it was cached, so
 * changing the prompts OR the controller (route.ts) empties this: re-run the seeds, then check each one with
 * `pnpm bench run ... --daily-neurons 0` (any cache miss is refused, nothing is spent) before writing it here.
 * The 27B has none, because a game of it costs about 6 times as much.
 */
export const CLEF_CACHED_SEEDS = "7-7";

/** Ids that shortcuts used before: `clef` was Clef-flash, and `clef-words` was its words-and-controller variant. */
const ALIASES: Readonly<Record<string, string>> = { clef: CLEF_ID, "clef-words": CLEF_ID };

export const canonicalPlayerId = (id: string): string => ALIASES[id] ?? id;

const HUMAN: PolicyChoice = {
  id: "human",
  presentation: "human",
  kind: "human",
  usesApi: false,
  factory: null,
};

const REFERENCES: readonly PolicyChoice[] = [
  {
    id: "lookahead",
    presentation: "lookahead",
    kind: "reference",
    usesApi: false,
    factory: lookaheadPolicy(),
  },
  {
    id: "always-forward",
    presentation: "always-forward",
    kind: "reference",
    usesApi: false,
    factory: alwaysForward,
  },
  {
    id: "random",
    presentation: "random",
    kind: "reference",
    usesApi: false,
    factory: randomPolicy,
  },
];

/**
 * The model players: the two sizes of Clef, with the same gameplay. The code turns the screen into words,
 * three small lookups ask the model, and a controller does the hopping and the detours (ADR-0011); the
 * panel and the log say so. The first twelve benchmark conditions, which leave the hopping to the model,
 * played like "always forward" and now open only as `Custom`.
 */
function modelChoices(client: ClefClient | null): PolicyChoice[] {
  const flash = decisionCost(DEFAULT_CLEF);
  const large = decisionCost(CLEF_27B_CONFIG);
  return [
    {
      id: CLEF_ID,
      presentation: "clef-flash",
      kind: "model",
      usesApi: true,
      neuronsPerDecision: flash.neurons,
      freeReplay: CLEF_CACHED_SEEDS,
      factory: client ? clefPolicy(client, DEFAULT_CLEF) : null,
    },
    {
      id: CLEF_27B_ID,
      presentation: "clef-27b",
      kind: "model",
      usesApi: true,
      neuronsPerDecision: large.neurons,
      factory: client ? clefPolicy(client, CLEF_27B_CONFIG) : null,
    },
  ];
}

/**
 * A player made from a benchmark id, `clef:<model>:<view>:<strategy>[:<style>]`, given in `CCR_PLAYER` to
 * try a combination while watching the log. Nothing about it is cached, so every move spends. Not a
 * valid id, or one of the standard players, gives nothing (the standard ones are already listed).
 */
export function customChoice(id: string, client: ClefClient | null): PolicyChoice | undefined {
  if (!id.startsWith("clef:")) return undefined;
  let config: ClefPolicyConfig;
  try {
    config = parseClefPolicyId(id);
  } catch {
    return undefined;
  }
  const canonical = clefPolicyId(config);
  const standard = [DEFAULT_CLEF, CLEF_27B_CONFIG].map(clefPolicyId);
  if (standard.includes(canonical)) return undefined;
  const { neurons } = decisionCost(config);
  return {
    id: canonical,
    presentation: "custom",
    kind: "model",
    usesApi: true,
    neuronsPerDecision: neurons,
    factory: client ? clefPolicy(client, config) : null,
  };
}

export function buildPolicyChoices(client: ClefClient | null): PolicyChoice[] {
  return [HUMAN, ...modelChoices(client), ...REFERENCES];
}
