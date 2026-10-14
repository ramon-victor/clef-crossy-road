import {
  alwaysForward,
  clefPolicy,
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
  /** Relative cost of an uncached decision, in neurons (measured, see AGENTS.md). */
  neuronsPerDecision?: number;
  /**
   * Seeds whose decisions are already in the cache for this player (from the benchmark runs), so
   * replaying them spends nothing. Any other seed asks the model and spends neurons.
   */
  freeReplay?: string;
  factory: PolicyFactory | null;
}

/** ~1,120 tokens per `choice` and ~3,070 per `critic` decision on clef-flash (3,455 neurons/M tokens). */
const FLASH_CHOICE = (1120 / 1e6) * 3455;
const FLASH_CRITIC = (3070 / 1e6) * 3455;
const CLEF_CHOICE = (1120 / 1e6) * 21818;

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

export function buildPolicyChoices(client: ClefClient | null): PolicyChoice[] {
  const model = (
    id: string,
    label: string,
    detail: string,
    neurons: number,
    config: Parameters<typeof clefPolicy>[1],
    freeReplay: string,
  ): PolicyChoice => ({
    id,
    label,
    detail,
    kind: "model",
    usesApi: true,
    neuronsPerDecision: neurons,
    freeReplay,
    factory: client ? clefPolicy(client, config) : null,
  });

  return [
    {
      id: "human",
      label: "You",
      detail: "Arrow keys or WASD",
      kind: "human",
      usesApi: false,
      factory: null,
    },
    model(
      "clef-flash-json",
      "Clef-flash · JSON",
      "9B model, observation as JSON, one choice question",
      FLASH_CHOICE,
      { model: "clef-flash", encoder: "json", strategy: "choice", manual: "full" },
      "1-100",
    ),
    model(
      "clef-flash-grid",
      "Clef-flash · grid",
      "9B model, observation drawn as a text grid",
      FLASH_CHOICE * 1.18,
      { model: "clef-flash", encoder: "grid", strategy: "choice", manual: "full" },
      "1-100",
    ),
    model(
      "clef-flash-critic",
      "Clef-flash · critic",
      "Asks 'does it die?' per move; goes forward unless risk > 50% (our rule)",
      FLASH_CRITIC,
      { model: "clef-flash", encoder: "json", strategy: "critic-go", manual: "full" },
      "1-71",
    ),
    model(
      "clef-27b-json",
      "Clef 27B · JSON",
      "The larger model; about 6x the cost per decision",
      CLEF_CHOICE,
      { model: "clef", encoder: "json", strategy: "choice", manual: "full" },
      "1-40",
    ),
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
}
