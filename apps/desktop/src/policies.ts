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
  factory: PolicyFactory | null;
}

/** ~1,120 tokens per `choice` and ~3,070 per `critic` decision on clef-flash (3,455 neurons/M tokens). */
const FLASH_CHOICE = (1120 / 1e6) * 3455;
const FLASH_CRITIC = (3070 / 1e6) * 3455;
const CLEF_CHOICE = (1120 / 1e6) * 21818;

export function buildPolicyChoices(client: ClefClient | null): PolicyChoice[] {
  const model = (
    id: string,
    label: string,
    detail: string,
    neurons: number,
    config: Parameters<typeof clefPolicy>[1],
  ): PolicyChoice => ({
    id,
    label,
    detail,
    kind: "model",
    usesApi: true,
    neuronsPerDecision: neurons,
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
    ),
    model(
      "clef-flash-grid",
      "Clef-flash · grid",
      "9B model, observation drawn as a text grid",
      FLASH_CHOICE * 1.18,
      { model: "clef-flash", encoder: "grid", strategy: "choice", manual: "full" },
    ),
    model(
      "clef-flash-critic",
      "Clef-flash · critic",
      "Asks 'does it die?' per move; goes forward unless risk > 50% (our rule)",
      FLASH_CRITIC,
      { model: "clef-flash", encoder: "json", strategy: "critic-go", manual: "full" },
    ),
    model(
      "clef-27b-json",
      "Clef 27B · JSON",
      "The larger model; about 6x the cost per decision",
      CLEF_CHOICE,
      { model: "clef", encoder: "json", strategy: "choice", manual: "full" },
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
