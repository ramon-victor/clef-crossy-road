import {
  type Answer,
  CLEF_MODELS,
  type ClefClient,
  type ClefModel,
  type ClefResult,
  type Question,
} from "@ccr/clef";
import { ACTIONS, type Action, type Observation } from "@ccr/core";
import { ACTION_PREFERENCE } from "./baselines.ts";
import { ENCODER_IDS, type EncoderId, encodeRequest } from "./encode.ts";
import type { Decision, ObservationPolicy, PolicyFactory } from "./policy.ts";
import {
  ACTION_CRITERIA,
  choiceInstructions,
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
 */
export const STRATEGY_IDS = ["choice", "critic", "critic-go"] as const;
export type StrategyId = (typeof STRATEGY_IDS)[number];

export interface ClefPolicyConfig {
  model: ClefModel;
  encoder: EncoderId;
  strategy: StrategyId;
  manual: ManualId;
}

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

/** Inverse of `clefPolicyId`. The manual defaults to `full`; anything unknown throws. */
export function parseClefPolicyId(id: string): ClefPolicyConfig {
  const [prefix, model, encoder, strategy, manual = "full"] = id.split(":");
  if (prefix !== "clef") throw new Error(`Not a Clef policy id: "${id}"`);
  return {
    model: oneOf(CLEF_MODELS, model, "model", id),
    encoder: oneOf(ENCODER_IDS, encoder, "encoder", id),
    strategy: oneOf(STRATEGY_IDS, strategy, "strategy", id),
    manual: oneOf(MANUAL_IDS, manual, "manual", id),
  };
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

  const choiceQuestion: Question = {
    type: "choice",
    instructions: choiceInstructions(config.manual, config.encoder),
    criteria: { ...ACTION_CRITERIA },
  };
  const riskQuestions: Record<string, Question> = Object.fromEntries(
    ACTIONS.map((a) => [
      riskQuestionId(a),
      { type: "noul", instructions: riskInstructions(config.manual, a, config.encoder) },
    ]),
  );

  const policy: ObservationPolicy = {
    kind: "observation",
    id,
    async decide(obs: Observation): Promise<Decision> {
      const { state, images } = encodeRequest(config.encoder, obs);
      if (config.strategy === "choice") {
        const result = await client.run({
          model: config.model,
          state,
          ...(images ? { images } : {}),
          questions: { move: choiceQuestion },
          cacheTag,
        });
        return fromChoice(result);
      }
      const result = await client.run({
        model: config.model,
        state,
        ...(images ? { images } : {}),
        questions: riskQuestions,
        cacheTag,
      });
      return fromRisk(result, config.strategy === "critic-go" ? selectGoUnlessRisky : selectByRisk);
    },
  };
  return { id, create: () => policy };
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

function fromRisk(result: ClefResult, select: (risk: Record<Action, number>) => Action): Decision {
  const risk = {} as Record<Action, number>;
  for (const action of ACTIONS) {
    const answer = result.answers[riskQuestionId(action)];
    if (answer?.type !== "noul") throw new Error(`Clef returned no risk answer for ${action}`);
    risk[action] = answer.noul;
  }
  return { action: select(risk), extra: { risk }, ...meta(result) };
}
