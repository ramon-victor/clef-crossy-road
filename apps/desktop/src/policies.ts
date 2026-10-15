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

/** The ids of the two model players, which is what `CCR_PLAYER` and `?player=` select. */
export const CLEF_ID = "clef-flash";
export const CLEF_27B_ID = "clef-27b";

/**
 * The same view and the same question for the bigger model, so the only thing that changes is the
 * model. `DEFAULT_CLEF` is Clef-flash's.
 */
export const CLEF_27B_CONFIG: ClefPolicyConfig = { ...DEFAULT_CLEF, model: "clef" };

/** Ids that shortcuts used before there were two models: `clef` was Clef-flash. */
const ALIASES: Readonly<Record<string, string>> = { clef: CLEF_ID };

export const canonicalPlayerId = (id: string): string => ALIASES[id] ?? id;

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
 * The model players: the two sizes of Clef, with the same view and the same question. The other views,
 * the critic and the prompt styles were conditions of the benchmark and none played better than
 * "always forward" (docs/07). The seeds in `freeReplay` are the ones whose decisions the benchmark left
 * in the cache for this exact request.
 */
function modelChoices(client: ClefClient | null): PolicyChoice[] {
  const flash = decisionCost(DEFAULT_CLEF);
  const large = decisionCost(CLEF_27B_CONFIG);
  return [
    {
      id: CLEF_ID,
      label: "Clef-flash",
      detail:
        "Cloudflare's 9B decision model picks every move. It sees the whole screen, where things will be in 0.2 s and its last moves, and still plays about like 'always forward' (3.7 rows)",
      kind: "model",
      usesApi: true,
      neuronsPerDecision: flash.neurons,
      freeReplay: "1-100",
      factory: client ? clefPolicy(client, DEFAULT_CLEF) : null,
    },
    {
      id: CLEF_27B_ID,
      label: "Clef (27B)",
      detail: `Cloudflare's larger model, with the same view and question as Clef-flash. About ${Math.round(large.neurons / flash.neurons)} times the cost: ${Math.round(large.neurons)} neurons per move, so the free tier lasts ${Math.floor(10_000 / large.neurons)} moves a day. In our tests it also drowns at the first river.`,
      kind: "model",
      usesApi: true,
      neuronsPerDecision: large.neurons,
      freeReplay: "1-8",
      factory: client ? clefPolicy(client, CLEF_27B_CONFIG) : null,
    },
  ];
}

/**
 * A player made from a benchmark id, `clef:<model>:<view>:<strategy>[:<style>]`, given in `CCR_PLAYER` to
 * try a combination while watching the log. Nothing about it is cached, so every move spends. Not a
 * valid id, or one of the two standard players, gives nothing (the standard ones are already listed).
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
  if (canonical === clefPolicyId(DEFAULT_CLEF) || canonical === clefPolicyId(CLEF_27B_CONFIG)) {
    return undefined;
  }
  const { neurons } = decisionCost(config);
  return {
    id: canonical,
    label: `Custom: ${canonical}`,
    detail: `A combination from the benchmark. Nothing about it is cached, so every move asks the model and spends about ${Math.round(neurons)} neurons.`,
    kind: "model",
    usesApi: true,
    neuronsPerDecision: neurons,
    factory: client ? clefPolicy(client, config) : null,
  };
}

export function buildPolicyChoices(client: ClefClient | null): PolicyChoice[] {
  return [HUMAN, ...modelChoices(client), ...REFERENCES];
}
