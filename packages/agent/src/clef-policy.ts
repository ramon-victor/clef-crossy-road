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
import { choiceAnswers } from "./answers.ts";
import { ACTION_PREFERENCE } from "./baselines.ts";
import { ENCODER_IDS, ENCODER_LEVEL, type EncoderId, encodeRequest } from "./encode.ts";
import { Executor, MANEUVER_ACTION, MANEUVER_IDS, type Maneuver } from "./executor.ts";
import { lanesState, MANEUVER_NAMES, movesState } from "./lanes.ts";
import type { Memory } from "./memory.ts";
import type {
  DecideHooks,
  Decision,
  ModelInput,
  ObservationPolicy,
  PolicyFactory,
} from "./policy.ts";
import {
  choiceInstructions,
  criteriaFor,
  GRAPH_GO_CRITERIA,
  GRAPH_MANEUVER_GO_CRITERIA,
  GRAPH_MANEUVER_SIDE_CRITERIA,
  GRAPH_SIDE_CRITERIA,
  graphInstructions,
  graphManeuverInstructions,
  MANUAL_IDS,
  type ManualId,
  PROMPT_VERSION,
  riskInstructions,
  riskQuestionId,
} from "./prompts.ts";
import { routePolicy } from "./route-policy.ts";

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
 * graph:     two small `choice` questions in one request, instead of one with five options: can the
 *            chicken hop forward (go or hold), and if not, which other move. Our rule on top is only the
 *            routing: go means hop_forward, hold means the answer of the second question. Only with the
 *            `moves` view and the `ordered` manual (ADR-0010).
 * graph-maneuver: the same two questions about manoeuvres, with the executor of `maneuver` doing the hopping.
 * route:     two small lookups in one request (`ahead`: open, passing or closed; `around`: left, right or
 *            wait) and a controller that crosses, waits for a gap, or walks a detour (route.ts). Only with the
 *            `scene` view and the `lookup` manual (ADR-0011).
 */
export const STRATEGY_IDS = [
  "choice",
  "critic",
  "critic-go",
  "maneuver",
  "graph",
  "graph-maneuver",
  "route",
] as const;
export type StrategyId = (typeof STRATEGY_IDS)[number];

export interface ClefPolicyConfig {
  model: ClefModel;
  encoder: EncoderId;
  strategy: StrategyId;
  manual: ManualId;
}

/**
 * The Clef the desktop app plays (Clef-flash, and the 27B with the same gameplay) and the bare `clef` policy
 * means on the bench command line: the most help the benchmark tried (ADR-0010 and ADR-0011). The code turns
 * the screen into words (`scene`), three small lookups with solved examples ask the model (`route`, `lookup`),
 * and a controller does the hopping and the detours. The report labels it "words + rules + graph + route
 * executor". The first twelve conditions, which show the model the world and leave the hopping to it, played
 * like "always forward" (docs/07); they stay in the benchmark as controls and open in the app as `Custom`.
 */
export const DEFAULT_CLEF: ClefPolicyConfig = {
  model: "clef-flash",
  encoder: "scene",
  strategy: "route",
  manual: "lookup",
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

/** The words views and their manuals go in pairs, and manoeuvres only exist for those pairs. */
const WORDS_PAIRS: ReadonlyArray<readonly [EncoderId, ManualId]> = [
  ["lanes", "rules"],
  ["moves", "ordered"],
];

function assertSupported(config: ClefPolicyConfig, id: string): void {
  if (config.manual === "rules" && config.encoder !== "lanes") {
    throw new Error(`The rules manual only reads the lanes view: "${id}"`);
  }
  if (
    (config.manual === "ordered" || config.manual === "exclusive") &&
    config.encoder !== "moves"
  ) {
    throw new Error(`The ordered and exclusive manuals only read the moves view: "${id}"`);
  }
  if (
    config.strategy === "maneuver" &&
    !WORDS_PAIRS.some(([encoder, manual]) => encoder === config.encoder && manual === config.manual)
  ) {
    throw new Error(
      `The maneuver strategy needs the lanes view with the rules manual, or the moves view with the ordered manual: "${id}"`,
    );
  }
  if (
    (config.strategy === "graph" || config.strategy === "graph-maneuver") &&
    (config.encoder !== "moves" || config.manual !== "ordered")
  ) {
    throw new Error(`The graph strategies need the moves view and the ordered manual: "${id}"`);
  }
  const routes = config.strategy === "route";
  if (routes !== (config.encoder === "scene") || routes !== (config.manual === "lookup")) {
    throw new Error(
      `The route strategy, the scene view and the lookup manual only go together: "${id}"`,
    );
  }
  if (
    (config.encoder === "lanes" || config.encoder === "moves" || config.encoder === "scene") &&
    (config.strategy === "critic" || config.strategy === "critic-go")
  ) {
    throw new Error(`The critic strategies are not defined for the words views: "${id}"`);
  }
}

/** What the help to the model amounts to, for reports: the view, plus the rules and the executor when they are on. */
export function helpLabel(config: ClefPolicyConfig): string {
  const parts: string[] = [ENCODER_LEVEL[config.encoder]];
  if (
    config.manual === "rules" ||
    config.manual === "ordered" ||
    config.manual === "exclusive" ||
    config.manual === "lookup"
  ) {
    parts.push("rules");
  }
  if (
    config.strategy === "graph" ||
    config.strategy === "graph-maneuver" ||
    config.strategy === "route"
  ) {
    parts.push("graph");
  }
  if (config.strategy === "route") parts.push("platform clock", "route executor");
  if (config.strategy === "maneuver" || config.strategy === "graph-maneuver")
    parts.push("executor");
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
  if (config.strategy === "route") return routePolicy(client, config, id);
  const cacheTag = `${PROMPT_VERSION}|${config.encoder}|${config.strategy}|${config.manual}`;
  const maneuvers = config.strategy === "maneuver" || config.strategy === "graph-maneuver";
  const graphs = config.strategy === "graph" || config.strategy === "graph-maneuver";

  const choiceQuestion: Question = {
    type: "choice",
    instructions: choiceInstructions(config.manual, config.encoder, config.strategy),
    criteria: {
      ...(config.strategy === "maneuver"
        ? criteriaFor(config.manual, "maneuver")
        : criteriaFor(config.manual)),
    },
  };
  const riskQuestions: Record<string, Question> = Object.fromEntries(
    ACTIONS.map((a) => [
      riskQuestionId(a),
      { type: "noul", instructions: riskInstructions(config.manual, a, config.encoder) },
    ]),
  );

  const graphQuestions: Record<string, Question> = maneuvers
    ? {
        go: {
          type: "choice",
          instructions: graphManeuverInstructions("go"),
          criteria: { ...GRAPH_MANEUVER_GO_CRITERIA },
        },
        side: {
          type: "choice",
          instructions: graphManeuverInstructions("side"),
          criteria: { ...GRAPH_MANEUVER_SIDE_CRITERIA },
        },
      }
    : {
        go: {
          type: "choice",
          instructions: graphInstructions("go"),
          criteria: { ...GRAPH_GO_CRITERIA },
        },
        side: {
          type: "choice",
          instructions: graphInstructions("side"),
          criteria: { ...GRAPH_SIDE_CRITERIA },
        },
      };

  const questions = graphs
    ? graphQuestions
    : config.strategy === "choice" || maneuvers
      ? { move: choiceQuestion }
      : riskQuestions;

  /** The one place a request is put together, so what is shown is what is sent. */
  const requestFor = (obs: Observation, memory?: Memory, lastManeuver?: string): ClefRequest => {
    if (maneuvers) {
      const lanes = lanesState(obs, memory, lastManeuver);
      const state =
        config.encoder === "moves" ? movesState(lanes, MANEUVER_NAMES, { movement: true }) : lanes;
      return { model: config.model, state, questions, cacheTag };
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
      async decide(obs: Observation, memory?: Memory, hooks?: DecideHooks): Promise<Decision> {
        if (!maneuvers) {
          const request = requestFor(obs, memory);
          const sent = inputOf(request);
          hooks?.onAsk?.(sent);
          const result = await client.run(request);
          const decision =
            config.strategy === "choice"
              ? fromChoice(result)
              : config.strategy === "graph"
                ? fromGraph(result)
                : fromRisk(
                    result,
                    config.strategy === "critic-go" ? selectGoUnlessRisky : selectByRisk,
                  );
          return { ...decision, sent };
        }
        const state = lanesState(obs, memory);
        const step = executor.next(state);
        if (step) return { action: step.action, source: "executor", note: step.note };
        const request = requestFor(obs, memory, executor.lastResult);
        const sent = inputOf(request);
        hooks?.onAsk?.(sent);
        const answered = await client.run(request);
        const chosen = graphs ? fromGraphManeuver(answered) : fromManeuver(answered);
        const first = executor.start(chosen.maneuver, state);
        return {
          ...chosen.decision,
          action: first.action,
          source: "model",
          note: `model chose ${chosen.maneuver}; ${first.note}`,
          extra: { ...chosen.decision.extra, maneuver: chosen.maneuver },
          sent,
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
    ...choiceAnswers(result),
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

/**
 * The two answers of the `graph` strategy as one decision: `go` is hop_forward, anything else is the
 * answer to the second question. The probabilities shown are the joint ones this routing implies:
 * P(go) on hop_forward, and P(hold) split by the second answer on the rest.
 */
function fromGraph(result: ClefResult): Decision {
  const go = result.answers.go;
  const side = result.answers.side;
  if (go?.type !== "choice") throw new Error("Clef returned no `go` choice answer");
  if (side?.type !== "choice") throw new Error("Clef returned no `side` choice answer");
  if (!isAction(side.choice) || side.choice === "hop_forward") {
    throw new Error(`Clef chose an unknown side move: ${side.choice}`);
  }
  const pGo = go.probabilities.go ?? 0;
  const probabilities: Partial<Record<Action, number>> = { hop_forward: pGo };
  for (const action of ACTIONS) {
    const p = side.probabilities[action];
    if (action !== "hop_forward" && p !== undefined) probabilities[action] = (1 - pGo) * p;
  }
  return {
    action: go.choice === "go" ? "hop_forward" : side.choice,
    probabilities,
    ...(go.confidence !== undefined ? { confidence: go.confidence } : {}),
    extra: { go: pGo, side: side.choice },
    ...meta(result),
  };
}

/** The two answers of `graph-maneuver`: `go` is crossing ahead, anything else is the second answer. */
function fromGraphManeuver(result: ClefResult): { maneuver: Maneuver; decision: Decision } {
  const go = result.answers.go;
  const side = result.answers.side;
  if (go?.type !== "choice") throw new Error("Clef returned no `go` choice answer");
  if (side?.type !== "choice") throw new Error("Clef returned no `side` choice answer");
  if (!isManeuver(side.choice) || side.choice === "cross_ahead") {
    throw new Error(`Clef chose an unknown side manoeuvre: ${side.choice}`);
  }
  const pGo = go.probabilities.go ?? 0;
  const probabilities: Partial<Record<Action, number>> = { [MANEUVER_ACTION.cross_ahead]: pGo };
  for (const maneuver of MANEUVER_IDS) {
    const p = side.probabilities[maneuver];
    if (maneuver !== "cross_ahead" && p !== undefined) {
      probabilities[MANEUVER_ACTION[maneuver]] = (1 - pGo) * p;
    }
  }
  const maneuver: Maneuver = go.choice === "go" ? "cross_ahead" : side.choice;
  return {
    maneuver,
    decision: {
      action: MANEUVER_ACTION[maneuver],
      probabilities,
      ...(go.confidence !== undefined ? { confidence: go.confidence } : {}),
      extra: { go: pGo, side: side.choice },
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
