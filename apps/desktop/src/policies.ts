import {
  alwaysForward,
  type ClefPolicyConfig,
  clefPolicy,
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

interface ModelSpec {
  id: string;
  label: string;
  detail: string;
  config: ClefPolicyConfig;
  freeReplay: string;
}

const flash = (
  encoder: ClefPolicyConfig["encoder"],
  strategy: ClefPolicyConfig["strategy"],
): ClefPolicyConfig => ({ model: "clef-flash", encoder, strategy, manual: "full" });

const MODELS: readonly ModelSpec[] = [
  {
    id: "clef-flash-json",
    label: "Clef-flash · JSON",
    detail: "9B model, observation as JSON, one choice question",
    config: flash("json", "choice"),
    freeReplay: "1-100",
  },
  {
    id: "clef-flash-grid",
    label: "Clef-flash · grid",
    detail: "9B model, observation drawn as a text grid",
    config: flash("grid", "choice"),
    freeReplay: "1-100",
  },
  {
    id: "clef-flash-critic",
    label: "Clef-flash · critic",
    detail: "Asks 'does it die?' per move; goes forward unless risk > 50% (our rule)",
    config: flash("json", "critic-go"),
    freeReplay: "1-71",
  },
  {
    id: "clef-27b-json",
    label: "Clef 27B · JSON",
    detail: "The larger model; about 6x the cost per decision",
    config: { model: "clef", encoder: "json", strategy: "choice", manual: "full" },
    freeReplay: "1-40",
  },
];

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

export function buildPolicyChoices(client: ClefClient | null): PolicyChoice[] {
  const models = MODELS.map(
    ({ config, ...spec }): PolicyChoice => ({
      ...spec,
      kind: "model",
      usesApi: true,
      neuronsPerDecision: decisionCost(config).neurons,
      factory: client ? clefPolicy(client, config) : null,
    }),
  );
  return [HUMAN, ...models, ...REFERENCES];
}
