import type { Answer, ClefClient, ClefRequest, ClefResult } from "@ccr/clef";
import { ACTIONS, type Action, type Observation } from "@ccr/core";
import { choiceAnswers } from "./answers.ts";
import type { ClefPolicyConfig } from "./clef-policy.ts";
import { emptyMemory, type Memory } from "./memory.ts";
import type { DecisionNotice } from "./notice.ts";
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
  type AroundOption,
  CELL_OPTIONS,
  HERE_OPTIONS,
  HERE_QUESTION_ID,
  MOVING_OPTIONS,
  RIDE_OPTIONS,
  RIDE_QUESTION_ID,
  ROUTE_QUESTION_IDS,
  routeQuestions,
} from "./route-prompts.ts";
import { sceneState } from "./scene.ts";

/**
 * The `route` strategy (ADR-0011): four small lookups in one request (`cell`, `moving`, `around`, and `here`, the
 * cell under the chicken), and a fifth, `ride`, while the chicken stands on a platform. The only rule of ours on the
 * answers is the routing: a platform a moment from the edge means `leave_platform`; a cell the chicken cannot stay on
 * means `step_off`; a cell to stand on ahead, or things that keep moving, mean `cross_ahead`; otherwise the way is
 * closed and `around` decides. A controller (route.ts) then does the hopping, and the steps it takes are not model
 * calls. Nothing steps in when an answer is wrong: a chicken left on a cell that cannot hold it stays there.
 */
export function routePolicy(
  client: ClefClient,
  config: ClefPolicyConfig,
  id: string,
): PolicyFactory {
  const live = config.strategy === "route-live";
  const questions = routeQuestions();
  const questionsOnAPlatform = routeQuestions(true);
  // `route-live` sends the same questions as `route`, so a request both can make is one cache entry.
  const cacheTag = `${PROMPT_VERSION}|${config.encoder}|route|${config.manual}`;

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
    const executor = new RouteExecutor({ live });
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
            ...(step.preview ? { preview: step.preview } : {}),
            source: "executor",
            note: step.note,
            notice: step.notice,
            extra: { controller: step.step },
          };
        }
        const request = requestFor(obs, memory, executor);
        const sent = inputOf(request);
        hooks?.onAsk?.(sent);
        const chosen = fromRoute(await client.run(request), { live });
        const { act, started, note, notice } = begin(executor, chosen, obs, memory);
        return {
          ...chosen.decision,
          probabilities: withExits(chosen.decision.probabilities, chosen.pExit, act.action),
          action: act.action,
          ...(act.preview ? { preview: act.preview } : {}),
          source: "model",
          note: `model chose ${chosen.maneuver}; ${note}`,
          notice: { kind: "model", maneuver: chosen.maneuver, step: notice },
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

/** A manoeuvre that cannot begin passes to the next of the model's own answers, without asking again. */
function begin(
  executor: RouteExecutor,
  chosen: Pick<RouteChoice, "maneuver" | "fallbacks">,
  obs: Observation,
  memory: Memory,
): { act: RouteAct; started: RouteManeuver; note: string; notice: DecisionNotice } {
  let act = executor.start(chosen.maneuver, obs, memory);
  let started = chosen.maneuver;
  const refusals: string[] = [];
  const notices: DecisionNotice[] = [];
  for (const next of chosen.fallbacks) {
    if (!act.refused) break;
    refusals.push(executor.lastResult ?? "");
    notices.push(act.notice);
    act = executor.start(next, obs, memory);
    started = next;
  }
  return {
    act,
    started,
    note: [...refusals, act.note].join("; "),
    notice: { kind: "sequence", parts: [...notices, act.notice] },
  };
}

/** What to try after `chosen` is refused: the detours the model gave, by probability. Waiting is what a refusal already does. */
export function refusalOrder(
  chosen: RouteManeuver,
  around: Readonly<Record<AroundOption, number>>,
): RouteManeuver[] {
  if (chosen === "wait_here" || chosen === "wait_gap") return [];
  if (chosen === "leave_platform" || chosen === "step_off") return [];
  return AROUND_OPTIONS.filter((option) => option !== "wait_here" && option !== chosen).sort(
    (a, b) => around[b] - around[a],
  );
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
export interface RouteChoice {
  maneuver: RouteManeuver;
  decision: Decision;
  pLeaving?: number;
  /** What the model gave to getting off the platform or the cell, which goes on the hop made. */
  pExit: number;
  fallbacks: RouteManeuver[];
}

export function fromRoute(
  result: ClefResult,
  { live = false }: { live?: boolean } = {},
): RouteChoice {
  const cell = choiceOf(result.answers[ROUTE_QUESTION_IDS[0]], CELL_OPTIONS, "cell");
  const moving = choiceOf(result.answers[ROUTE_QUESTION_IDS[1]], MOVING_OPTIONS, "moving");
  const around = choiceOf(result.answers[ROUTE_QUESTION_IDS[2]], AROUND_OPTIONS, "around");
  const here = choiceOf(result.answers[HERE_QUESTION_ID], HERE_OPTIONS, "here");
  const ride =
    result.answers[RIDE_QUESTION_ID] === undefined
      ? null
      : choiceOf(result.answers[RIDE_QUESTION_ID], RIDE_OPTIONS, "ride");
  const pStand = cell.probabilities.stand;
  const pMoving = moving.probabilities.moving;
  const pLeaving = ride?.probabilities.leaving;
  const pMoveOff = here.probabilities.move_off;
  const pCross = pStand + (1 - pStand) * pMoving;
  const pClosed = 1 - pCross;
  const ahead =
    cell.choice === "stand" ? "open" : moving.choice === "moving" ? "passing" : "closed";
  const maneuver: RouteManeuver =
    ride?.choice === "leaving"
      ? "leave_platform"
      : here.choice === "move_off"
        ? "step_off"
        : ahead === "closed"
          ? around.choice
          : ahead === "passing" && live
            ? "wait_gap"
            : "cross_ahead";
  // `ride` and `here` take their shares one after the other, so that the bars still add up to one.
  const pExit = (pLeaving ?? 0) + (1 - (pLeaving ?? 0)) * pMoveOff;
  const rest = 1 - pExit;
  // Live, the model alone times the hop: only a standable cell is a hop, and things that pass are a step of waiting.
  const pHop = live ? pStand : pCross;
  const probabilities: Partial<Record<Action, number>> = { hop_forward: pHop * rest };
  for (const option of AROUND_OPTIONS) {
    probabilities[ROUTE_ACTION[option]] = pClosed * around.probabilities[option] * rest;
  }
  if (live) probabilities.stay = (probabilities.stay ?? 0) + (pCross - pStand) * rest;
  for (const action of ACTIONS) probabilities[action] ??= 0;
  return {
    maneuver,
    decision: {
      action:
        maneuver === "leave_platform" || maneuver === "step_off" ? "stay" : ROUTE_ACTION[maneuver],
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
        here: here.choice,
        pMoveOff,
        ...(live ? { live: true } : {}),
        ...(ride === null ? {} : { ride: ride.choice, pLeaving }),
      },
      latencyMs: result.latencyMs,
      inputTokens: result.usage.inputTokens,
      neurons: result.neurons,
      cached: result.cached,
      ...choiceAnswers(result),
    },
    ...(pLeaving === undefined ? {} : { pLeaving }),
    pExit,
    fallbacks: refusalOrder(maneuver, around.probabilities),
  };
}

/** What the model gave to leaving the platform (`ride`) or stepping off its cell (`here`) goes on the hop made. */
function withExits(
  probabilities: Partial<Record<Action, number>> | undefined,
  share: number,
  exit: Action,
): Partial<Record<Action, number>> {
  return { ...probabilities, [exit]: (probabilities?.[exit] ?? 0) + share };
}
