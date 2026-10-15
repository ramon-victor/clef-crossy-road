import type { Answer, ClefClient, ClefRequest, ClefResult } from "@ccr/clef";
import { ACTIONS, type Action, type Observation } from "@ccr/core";
import type { ClefPolicyConfig } from "./clef-policy.ts";
import { emptyMemory, type Memory } from "./memory.ts";
import type { Decision, ModelInput, ObservationPolicy, PolicyFactory } from "./policy.ts";
import { PROMPT_VERSION } from "./prompts.ts";
import { ROUTE_ACTION, RouteExecutor, type RouteManeuver } from "./route.ts";
import {
  AROUND_OPTIONS,
  CELL_OPTIONS,
  MOVING_OPTIONS,
  ROUTE_QUESTION_IDS,
  routeQuestions,
} from "./route-prompts.ts";
import { sceneState } from "./scene.ts";

/**
 * The `route` strategy (ADR-0011): three small lookups in one request. `cell` says whether the chicken can
 * stand on the cell straight ahead, `moving` whether the things of that row move, and `around` which way to go
 * if the way ahead is closed (left, right, wait). The only rule of ours on the answers is the routing: a cell
 * to stand on, or things that keep moving, mean `cross_ahead`; otherwise the way is closed and `around`
 * decides. A controller (route.ts) then does the hopping, and steps it takes are not model calls.
 */
export function routePolicy(
  client: ClefClient,
  config: ClefPolicyConfig,
  id: string,
): PolicyFactory {
  const questions = routeQuestions();
  const cacheTag = `${PROMPT_VERSION}|${config.encoder}|${config.strategy}|${config.manual}`;

  /** The one place a request is put together, so what is shown is what is sent. */
  const requestFor = (obs: Observation, memory: Memory, executor: RouteExecutor): ClefRequest => ({
    model: config.model,
    state: sceneState(obs, memory, {
      lastManeuver: executor.lastResult,
      failed: executor.failedSides(memory),
    }),
    questions,
    cacheTag,
  });

  const create = (): ObservationPolicy => {
    const executor = new RouteExecutor();
    return {
      kind: "observation",
      id,
      describe: (obs, memory = emptyMemory()) => inputOf(requestFor(obs, memory, executor)),
      async decide(obs: Observation, memory: Memory = emptyMemory()): Promise<Decision> {
        const step = executor.next(obs, memory);
        if (step) return { action: step.action, source: "executor", note: step.note };
        const request = requestFor(obs, memory, executor);
        const chosen = fromRoute(await client.run(request));
        const first = executor.start(chosen.maneuver, obs, memory);
        return {
          ...chosen.decision,
          action: first.action,
          source: "model",
          note: `model chose ${chosen.maneuver}; ${first.note}`,
          extra: { ...chosen.decision.extra, maneuver: chosen.maneuver },
          sent: inputOf(request),
        };
      },
    };
  };
  return { id, create };
}

function inputOf({ model, state, questions }: ClefRequest): ModelInput {
  return { model, state, questions };
}

function choiceOf<T extends string>(
  answer: Answer | undefined,
  options: readonly T[],
  name: string,
): { choice: T; probabilities: Record<T, number>; confidence: number | undefined } {
  if (answer?.type !== "choice") throw new Error(`Clef returned no \`${name}\` choice answer`);
  const choice = options.find((option) => option === answer.choice);
  if (choice === undefined)
    throw new Error(`Clef chose an unknown option for ${name}: ${answer.choice}`);
  const probabilities = Object.fromEntries(
    options.map((option) => [option, answer.probabilities[option] ?? 0]),
  ) as Record<T, number>;
  return { choice, probabilities, confidence: answer.confidence };
}

/**
 * The three answers as one decision. The probabilities shown are the joint ones the routing implies: the chance
 * of crossing is P(stand) + P(no_stand) * P(moving), and what is left (the way is closed) is split by the
 * third answer.
 */
export function fromRoute(result: ClefResult): { maneuver: RouteManeuver; decision: Decision } {
  const cell = choiceOf(result.answers[ROUTE_QUESTION_IDS[0]], CELL_OPTIONS, "cell");
  const moving = choiceOf(result.answers[ROUTE_QUESTION_IDS[1]], MOVING_OPTIONS, "moving");
  const around = choiceOf(result.answers[ROUTE_QUESTION_IDS[2]], AROUND_OPTIONS, "around");
  const pStand = cell.probabilities.stand;
  const pMoving = moving.probabilities.moving;
  const pCross = pStand + (1 - pStand) * pMoving;
  const pClosed = 1 - pCross;
  const ahead =
    cell.choice === "stand" ? "open" : moving.choice === "moving" ? "passing" : "closed";
  const maneuver: RouteManeuver = ahead === "closed" ? around.choice : "cross_ahead";
  const probabilities: Partial<Record<Action, number>> = { hop_forward: pCross };
  for (const option of AROUND_OPTIONS) {
    probabilities[ROUTE_ACTION[option]] = pClosed * around.probabilities[option];
  }
  for (const action of ACTIONS) probabilities[action] ??= 0;
  return {
    maneuver,
    decision: {
      action: ROUTE_ACTION[maneuver],
      probabilities,
      ...(cell.confidence !== undefined ? { confidence: cell.confidence } : {}),
      extra: {
        ahead,
        cell: cell.choice,
        pStand,
        moving: moving.choice,
        pMoving,
        pClosed,
        around: around.choice,
      },
      latencyMs: result.latencyMs,
      inputTokens: result.usage.inputTokens,
      neurons: result.neurons,
      cached: result.cached,
    },
  };
}
