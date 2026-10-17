import type { Answer, ClefClient, ClefRequest, ClefResult } from "@ccr/clef";
import { ACTIONS, type Action, type Observation } from "@ccr/core";
import { choiceAnswers } from "./answers.ts";
import type { ClefPolicyConfig } from "./clef-policy.ts";
import { emptyMemory, type Memory } from "./memory.ts";
import type {
  DecideHooks,
  Decision,
  ModelInput,
  ObservationPolicy,
  PolicyFactory,
} from "./policy.ts";
import { PROMPT_VERSION } from "./prompts.ts";
import { ROUTE_ACTION, type RouteAct, RouteExecutor, type RouteManeuver } from "./route.ts";
import {
  AROUND_OPTIONS,
  CELL_OPTIONS,
  MOVING_OPTIONS,
  RIDE_OPTIONS,
  RIDE_QUESTION_ID,
  ROUTE_QUESTION_IDS,
  routeQuestions,
} from "./route-prompts.ts";
import { sceneState } from "./scene.ts";

/**
 * The `route` strategy (ADR-0011): three small lookups in one request (`cell`, `moving`, `around`), and a fourth,
 * `ride`, while the chicken stands on a platform. The only rule of ours on the answers is the routing: a platform a
 * moment from the edge means `leave_platform`; a cell to stand on, or things that keep moving, mean `cross_ahead`;
 * otherwise the way is closed and `around` decides. A controller (route.ts) then does the hopping, and the steps it
 * takes are not model calls.
 */
export function routePolicy(
  client: ClefClient,
  config: ClefPolicyConfig,
  id: string,
): PolicyFactory {
  const questions = routeQuestions();
  const questionsOnAPlatform = routeQuestions(true);
  const cacheTag = `${PROMPT_VERSION}|${config.encoder}|${config.strategy}|${config.manual}`;

  /** The one place a request is put together, so what is shown is what is sent. */
  const requestFor = (obs: Observation, memory: Memory, executor: RouteExecutor): ClefRequest => ({
    model: config.model,
    state: sceneState(obs, memory, {
      lastManeuver: executor.lastResult,
      failed: executor.failedSides(memory),
    }),
    questions: obs.player.riding ? questionsOnAPlatform : questions,
    cacheTag,
  });

  const create = (): ObservationPolicy => {
    const executor = new RouteExecutor();
    return {
      kind: "observation",
      id,
      describe: (obs, memory = emptyMemory()) => inputOf(requestFor(obs, memory, executor)),
      async decide(
        obs: Observation,
        memory: Memory = emptyMemory(),
        hooks?: DecideHooks,
      ): Promise<Decision> {
        const step = executor.next(obs, memory);
        if (step) {
          return {
            action: step.action,
            source: "executor",
            note: step.note,
            extra: { controller: step.step },
          };
        }
        const request = requestFor(obs, memory, executor);
        const sent = inputOf(request);
        hooks?.onAsk?.(sent);
        const chosen = fromRoute(await client.run(request));
        const { act, started, note } = begin(executor, chosen, obs, memory);
        return {
          ...chosen.decision,
          ...(chosen.pLeaving === undefined
            ? {}
            : {
                probabilities: withLeaving(
                  chosen.decision.probabilities,
                  chosen.pLeaving,
                  act.action,
                ),
              }),
          action: act.action,
          source: "model",
          note: `model chose ${chosen.maneuver}; ${note}`,
          extra: {
            ...chosen.decision.extra,
            maneuver: chosen.maneuver,
            controller: act.step,
            ...(started === chosen.maneuver ? {} : { fallback: started }),
          },
          sent,
        };
      },
    };
  };
  return { id, create };
}

function inputOf({ model, state, questions }: ClefRequest): ModelInput {
  return { model, state, questions };
}

/**
 * Starts the manoeuvre the model chose. One that cannot begin (nothing to walk, water that never changes) passes to
 * the next of the model's own answers, in the order of its probabilities, without asking again.
 */
function begin(
  executor: RouteExecutor,
  chosen: { maneuver: RouteManeuver; fallbacks: readonly RouteManeuver[] },
  obs: Observation,
  memory: Memory,
): { act: RouteAct; started: RouteManeuver; note: string } {
  let act = executor.start(chosen.maneuver, obs, memory);
  let started = chosen.maneuver;
  const refusals: string[] = [];
  for (const next of chosen.fallbacks) {
    if (!act.refused) break;
    refusals.push(executor.lastResult ?? "");
    act = executor.start(next, obs, memory);
    started = next;
  }
  return { act, started, note: [...refusals, act.note].join("; ") };
}

/** What to try after `chosen` is refused: the answers to `around` by probability, all of them for "go straight", the others for a detour. */
export function refusalOrder(
  chosen: RouteManeuver,
  around: Readonly<Record<(typeof AROUND_OPTIONS)[number], number>>,
): RouteManeuver[] {
  if (chosen === "wait_here" || chosen === "leave_platform") return [];
  const ranked = [...AROUND_OPTIONS].sort((a, b) => around[b] - around[a]);
  return ranked.filter((option) => option !== chosen);
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
export function fromRoute(result: ClefResult): {
  maneuver: RouteManeuver;
  decision: Decision;
  pLeaving?: number;
  fallbacks: RouteManeuver[];
} {
  const cell = choiceOf(result.answers[ROUTE_QUESTION_IDS[0]], CELL_OPTIONS, "cell");
  const moving = choiceOf(result.answers[ROUTE_QUESTION_IDS[1]], MOVING_OPTIONS, "moving");
  const around = choiceOf(result.answers[ROUTE_QUESTION_IDS[2]], AROUND_OPTIONS, "around");
  const ride =
    result.answers[RIDE_QUESTION_ID] === undefined
      ? null
      : choiceOf(result.answers[RIDE_QUESTION_ID], RIDE_OPTIONS, "ride");
  const pStand = cell.probabilities.stand;
  const pMoving = moving.probabilities.moving;
  const pLeaving = ride?.probabilities.leaving;
  const pCross = pStand + (1 - pStand) * pMoving;
  const pClosed = 1 - pCross;
  const ahead =
    cell.choice === "stand" ? "open" : moving.choice === "moving" ? "passing" : "closed";
  const maneuver: RouteManeuver =
    ride?.choice === "leaving"
      ? "leave_platform"
      : ahead === "closed"
        ? around.choice
        : "cross_ahead";
  const rest = 1 - (pLeaving ?? 0);
  const probabilities: Partial<Record<Action, number>> = { hop_forward: pCross * rest };
  for (const option of AROUND_OPTIONS) {
    probabilities[ROUTE_ACTION[option]] = pClosed * around.probabilities[option] * rest;
  }
  for (const action of ACTIONS) probabilities[action] ??= 0;
  return {
    maneuver,
    decision: {
      action: maneuver === "leave_platform" ? "stay" : ROUTE_ACTION[maneuver],
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
        ...(ride === null ? {} : { ride: ride.choice, pLeaving }),
      },
      latencyMs: result.latencyMs,
      inputTokens: result.usage.inputTokens,
      neurons: result.neurons,
      cached: result.cached,
      ...choiceAnswers(result),
    },
    ...(pLeaving === undefined ? {} : { pLeaving }),
    fallbacks: refusalOrder(maneuver, around.probabilities),
  };
}

/** The platform's share goes on the hop made, so that the five bars still add up to one. */
function withLeaving(
  probabilities: Partial<Record<Action, number>> | undefined,
  pLeaving: number,
  exit: Action,
): Partial<Record<Action, number>> {
  return { ...probabilities, [exit]: (probabilities?.[exit] ?? 0) + pLeaving };
}
