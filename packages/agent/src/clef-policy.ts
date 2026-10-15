import {
  type Answer,
  CLEF_MODELS,
  type ClefClient,
  type ClefModel,
  type ClefRequest,
  type ClefResult,
  type Question,
} from "@ccr/clef";
import { ACTIONS, type Action, type Observation } from "@ccr/core";
import { ACTION_PREFERENCE } from "./baselines.ts";
import { ENCODER_IDS, ENCODER_LEVEL, type EncoderId, encodeRequest } from "./encode.ts";
import { Executor, MANEUVER_ACTION, MANEUVER_IDS, type Maneuver } from "./executor.ts";
import { lanesState } from "./lanes.ts";
import type { Memory } from "./memory.ts";
import type { Decision, ModelInput, ObservationPolicy, PolicyFactory } from "./policy.ts";
import {
  choiceInstructions,
  criteriaFor,
  MANUAL_IDS,
  type ManualId,
  PROMPT_VERSION,
  riskInstructions,
  riskQuestionId,
} from "./prompts.ts";

/**
 * choice:    one `choice` question over the five actions; the action is the model's argmax.
 * critic:    five `noul` questions ("does the chicken die if it does X?") plus a selection rule that
 *            is OUR logic: the lowest-risk action (see selectByRisk).
 * critic-go: the same questions, but with a bias towards progress: hop forward unless the model
 *            says it is more likely than not to die (see selectGoUnlessRisky).
 * The critic strategies add our own decision rule on top of the model, so they are separate
 * experimental conditions from `choice` and must be reported as such.
 * maneuver:  one `choice` question over five manoeuvres; the model picks WHAT to do and the executor
 *            (executor.ts) picks the moment and does the hopping, asking the model again only when the
 *            manoeuvre is over or cannot be carried out. Only with the `lanes` view and the `rules` manual.
 *            Steps the executor takes are not model calls and cost nothing (ADR-0010).
 */
export const STRATEGY_IDS = ["choice", "critic", "critic-go", "maneuver"] as const;
export type StrategyId = (typeof STRATEGY_IDS)[number];

export interface ClefPolicyConfig {
  model: ClefModel;
  encoder: EncoderId;
  strategy: StrategyId;
  manual: ManualId;
}

/**
 * The one Clef the desktop app plays and the bare `clef` policy means on the bench command line: the
 * model's own argmax over the five actions, the full manual, no rule of ours on top, and the view a
 * player has (the screen, where things will be in 0.2 s, and the last moves: ADR-0009). Over 100 games
 * it plays exactly like the plain `json` view (docs/07), so this is a choice about what the model is
 * shown, not about score. Every other combination is an experiment axis of the benchmark.
 */
export const DEFAULT_CLEF: ClefPolicyConfig = {
  model: "clef-flash",
  encoder: "json-fx",
  strategy: "choice",
  manual: "full",
};

/** The short policy id that `parseClefPolicyId` reads as `DEFAULT_CLEF`. */
export const DEFAULT_CLEF_ID = "clef";

/** `clef:<model>:<encoder>:<strategy>[:<manual>]`, e.g. `clef:clef-flash:json:choice:full`. */
export function clefPolicyId(config: ClefPolicyConfig): string {
  return `clef:${config.model}:${config.encoder}:${config.strategy}:${config.manual}`;
}

function oneOf<T extends string>(
  allowed: readonly T[],
  value: string | undefined,
  what: string,
  id: string,
): T {
  const found = allowed.find((candidate) => candidate === value);
  if (found === undefined) throw new Error(`Unknown ${what} in "${id}"`);
  return found;
}

/**
 * Inverse of `clefPolicyId`, and `clef` alone for `DEFAULT_CLEF`. The manual defaults to `full`;
 * anything unknown throws.
 */
export function parseClefPolicyId(id: string): ClefPolicyConfig {
  if (id === DEFAULT_CLEF_ID) return { ...DEFAULT_CLEF };
  const [prefix, model, encoder, strategy, manual = "full"] = id.split(":");
  if (prefix !== "clef") throw new Error(`Not a Clef policy id: "${id}"`);
  const config: ClefPolicyConfig = {
    model: oneOf(CLEF_MODELS, model, "model", id),
    encoder: oneOf(ENCODER_IDS, encoder, "encoder", id),
    strategy: oneOf(STRATEGY_IDS, strategy, "strategy", id),
    manual: oneOf(MANUAL_IDS, manual, "manual", id),
  };
  assertSupported(config, id);
  return config;
}

/** The `rules` options name the fields of the `lanes` view, and manoeuvres only exist for those options. */
function assertSupported(config: ClefPolicyConfig, id: string): void {
  if (config.manual === "rules" && config.encoder !== "lanes") {
    throw new Error(`The rules manual only reads the lanes view: "${id}"`);
  }
  if (config.strategy === "maneuver" && (config.encoder !== "lanes" || config.manual !== "rules")) {
    throw new Error(`The maneuver strategy needs the lanes view and the rules manual: "${id}"`);
  }
  if (
    config.encoder === "lanes" &&
    (config.strategy === "critic" || config.strategy === "critic-go")
  ) {
    throw new Error(`The critic strategies are not defined for the lanes view: "${id}"`);
  }
}

/** What the help to the model amounts to, for reports: the view, plus the rules and the executor when they are on. */
export function helpLabel(config: ClefPolicyConfig): string {
  const parts: string[] = [ENCODER_LEVEL[config.encoder]];
  if (config.manual === "rules") parts.push("rules");
  if (config.strategy === "maneuver") parts.push("executor");
  return parts.join(" + ");
}

/** Risks within this distance of the lowest one count as equally safe. */
export const RISK_TOLERANCE = 0.05;

export function selectByRisk(risk: Record<Action, number>): Action {
  const lowest = Math.min(...ACTIONS.map((a) => risk[a]));
  const acceptable = ACTION_PREFERENCE.filter((a) => risk[a] <= lowest + RISK_TOLERANCE);
  return acceptable[0] ?? "hop_forward";
}

/** Forward is taken unless the model puts its death probability above this. */
export const GO_RISK_LIMIT = 0.5;

export function selectGoUnlessRisky(risk: Record<Action, number>): Action {
  if (risk.hop_forward <= GO_RISK_LIMIT) return "hop_forward";
  const others = { ...risk, hop_forward: Number.POSITIVE_INFINITY };
  return selectByRisk(others);
}

export function clefPolicy(client: ClefClient, config: ClefPolicyConfig): PolicyFactory {
  const id = clefPolicyId(config);
  const cacheTag = `${PROMPT_VERSION}|${config.encoder}|${config.strategy}|${config.manual}`;
  const maneuvers = config.strategy === "maneuver";

  const choiceQuestion: Question = {
    type: "choice",
    instructions: choiceInstructions(config.manual, config.encoder, config.strategy),
    criteria: {
      ...(maneuvers ? criteriaFor(config.manual, "maneuver") : criteriaFor(config.manual)),
    },
  };
  const riskQuestions: Record<string, Question> = Object.fromEntries(
    ACTIONS.map((a) => [
      riskQuestionId(a),
      { type: "noul", instructions: riskInstructions(config.manual, a, config.encoder) },
    ]),
  );

  const questions =
    config.strategy === "choice" || maneuvers ? { move: choiceQuestion } : riskQuestions;

  /** The one place a request is put together, so what is shown is what is sent. */
  const requestFor = (obs: Observation, memory?: Memory, lastManeuver?: string): ClefRequest => {
    if (maneuvers) {
      return {
        model: config.model,
        state: lanesState(obs, memory, lastManeuver),
        questions,
        cacheTag,
      };
    }
    const { state, images } = encodeRequest(config.encoder, obs, memory);
    return { model: config.model, state, ...(images ? { images } : {}), questions, cacheTag };
  };

  /** A policy is created per episode: the executor remembers the manoeuvre in progress. */
  const create = (): ObservationPolicy => {
    const executor = new Executor();
    return {
      kind: "observation",
      id,
      describe: (obs, memory) => inputOf(requestFor(obs, memory, executor.lastResult)),
      async decide(obs: Observation, memory?: Memory): Promise<Decision> {
        if (!maneuvers) {
          const request = requestFor(obs, memory);
          const result = await client.run(request);
          const decision =
            config.strategy === "choice"
              ? fromChoice(result)
              : fromRisk(
                  result,
                  config.strategy === "critic-go" ? selectGoUnlessRisky : selectByRisk,
                );
          return { ...decision, sent: inputOf(request) };
        }
        const state = lanesState(obs, memory);
        const step = executor.next(state);
        if (step) return { action: step.action, source: "executor", note: step.note };
        const request = requestFor(obs, memory, executor.lastResult);
        const chosen = fromManeuver(await client.run(request));
        const first = executor.start(chosen.maneuver, state);
        return {
          ...chosen.decision,
          action: first.action,
          source: "model",
          note: `model chose ${chosen.maneuver}; ${first.note}`,
          extra: { maneuver: chosen.maneuver },
          sent: inputOf(request),
        };
      },
    };
  };
  return { id, create };
}

function inputOf({ model, state, questions, images }: ClefRequest): ModelInput {
  return { model, state, questions, ...(images ? { images: images.length } : {}) };
}

function isAction(value: string): value is Action {
  return (ACTIONS as readonly string[]).includes(value);
}

function meta(result: ClefResult) {
  return {
    latencyMs: result.latencyMs,
    inputTokens: result.usage.inputTokens,
    neurons: result.neurons,
    cached: result.cached,
  };
}

function fromChoice(result: ClefResult): Decision {
  const answer: Answer | undefined = result.answers.move;
  if (answer?.type !== "choice") throw new Error("Clef returned no `move` choice answer");
  if (!isAction(answer.choice)) throw new Error(`Clef chose an unknown option: ${answer.choice}`);
  const probabilities: Partial<Record<Action, number>> = {};
  for (const action of ACTIONS) {
    const p = answer.probabilities[action];
    if (p !== undefined) probabilities[action] = p;
  }
  return {
    action: answer.choice,
    probabilities,
    ...(answer.confidence !== undefined ? { confidence: answer.confidence } : {}),
    ...meta(result),
  };
}

const isManeuver = (value: string): value is Maneuver =>
  (MANEUVER_IDS as readonly string[]).includes(value);

/** The model's pick among manoeuvres. Its probabilities are reported on the move each manoeuvre is made of. */
function fromManeuver(result: ClefResult): { maneuver: Maneuver; decision: Decision } {
  const answer: Answer | undefined = result.answers.move;
  if (answer?.type !== "choice") throw new Error("Clef returned no `move` choice answer");
  if (!isManeuver(answer.choice))
    throw new Error(`Clef chose an unknown manoeuvre: ${answer.choice}`);
  const probabilities: Partial<Record<Action, number>> = {};
  for (const maneuver of MANEUVER_IDS) {
    const p = answer.probabilities[maneuver];
    if (p !== undefined) probabilities[MANEUVER_ACTION[maneuver]] = p;
  }
  return {
    maneuver: answer.choice,
    decision: {
      action: MANEUVER_ACTION[answer.choice],
      probabilities,
      ...(answer.confidence !== undefined ? { confidence: answer.confidence } : {}),
      ...meta(result),
    },
  };
}

function fromRisk(result: ClefResult, select: (risk: Record<Action, number>) => Action): Decision {
  const risk = {} as Record<Action, number>;
  for (const action of ACTIONS) {
    const answer = result.answers[riskQuestionId(action)];
    if (answer?.type !== "noul") throw new Error(`Clef returned no risk answer for ${action}`);
    risk[action] = answer.noul;
  }
  return { action: select(risk), extra: { risk }, ...meta(result) };
}
