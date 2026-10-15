import {
  ENCODER_LEVEL,
  inputAsText,
  type ModelInput,
  type PolicyFactory,
  parseClefPolicyId,
} from "@ccr/agent";
import { ACTIONS, type Action, observe } from "@ccr/core";
import { rebuild } from "./probe.ts";

/** Reads `--actions hop_forward,hop_left` into actions, refusing anything that is not one. */
export function parseActions(spec: string | undefined): Action[] {
  if (!spec?.trim()) return [];
  return spec.split(",").map((part) => {
    const name = part.trim();
    const action = ACTIONS.find((a) => a === name);
    if (!action) throw new Error(`Unknown action "${name}". Try ${ACTIONS.join(", ")}.`);
    return action;
  });
}

export interface ShownInput {
  /** Header lines: the policy, what it can see, how big the request is. */
  header: string;
  input: ModelInput;
}

/**
 * What a policy would send to its model for the state reached by playing `actions` on `seed`. Nothing
 * is sent: this only asks the policy to describe its request, so it costs nothing and needs no key.
 */
export function showInput(
  factory: PolicyFactory,
  seed: number,
  actions: readonly Action[],
): ShownInput {
  const policy = factory.create(seed);
  if (policy.kind !== "observation" || !policy.describe) {
    throw new Error(`${factory.id} does not send anything to a model.`);
  }
  const { game, memory } = rebuild({ seed, actions: [...actions] });
  if (!game.alive) throw new Error(`The chicken is dead after those actions (${game.deathCause}).`);
  const input = policy.describe(observe(game), memory);
  const level = factory.id.startsWith("clef:")
    ? ENCODER_LEVEL[parseClefPolicyId(factory.id).encoder]
    : "n/a";
  const size = JSON.stringify(input).length;
  const header = [
    `policy:     ${factory.id}`,
    `sees:       ${level}`,
    `state:      seed ${seed} after ${actions.length} move${actions.length === 1 ? "" : "s"}${actions.length ? ` (${actions.join(", ")})` : ""}`,
    `request:    ${size} characters, ${Object.keys(input.questions).length} question(s), nothing was sent`,
  ].join("\n");
  return { header, input };
}

export const renderShownInput = ({ header, input }: ShownInput): string =>
  `${header}\n\n${inputAsText(input)}\n`;
