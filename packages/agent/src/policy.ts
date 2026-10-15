import type { ClefModel, Question } from "@ccr/clef";
import type { Action, Game, Observation } from "@ccr/core";
import type { Memory } from "./memory.ts";

/**
 * Everything a model was asked for one decision, as sent: the state it evaluates and the questions
 * with their instructions and options. Pictures are only counted, so the record stays readable.
 */
export interface ModelInput {
  model: ClefModel;
  state: unknown;
  questions: Record<string, Question>;
  images?: number;
}

export interface Decision {
  action: Action;
  /** Per-action probabilities as returned by the model, when the strategy has them. */
  probabilities?: Partial<Record<Action, number>>;
  /** Cloudflare's undocumented `confidence`. Reported separately; it is not the top probability. */
  confidence?: number;
  latencyMs?: number;
  inputTokens?: number;
  neurons?: number;
  cached?: boolean;
  /** Strategy-specific numbers (for example per-action death risk in the critic strategy). */
  extra?: Record<string, unknown>;
  /**
   * What the model read to give this answer. For people to look at (the app shows it); the episode
   * records do not keep it.
   */
  sent?: ModelInput;
}

/**
 * Sees only the `Observation` and what the player remembers (ADR-0005, ADR-0009). The type is the
 * guard: a policy of this kind cannot get hold of the simulator, so it cannot peek at information the
 * fairness rule excludes.
 */
export interface ObservationPolicy {
  readonly kind: "observation";
  readonly id: string;
  decide(obs: Observation, memory?: Memory): Promise<Decision>;
  /** What `decide` would send for these inputs, without asking anything. */
  describe?(obs: Observation, memory?: Memory): ModelInput;
}

/** Gets the simulator itself. Reference baselines only; never a model. */
export interface OraclePolicy {
  readonly kind: "oracle";
  readonly id: string;
  decide(game: Game): Promise<Decision>;
}

export type Policy = ObservationPolicy | OraclePolicy;

/** A policy is created per episode so that stochastic ones can be seeded by the episode seed. */
export interface PolicyFactory {
  readonly id: string;
  create(seed: number): Policy;
}
