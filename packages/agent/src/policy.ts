import type { ClefModel, Question } from "@ccr/clef";
import type { Action, Game, Observation } from "@ccr/core";
import type { Memory } from "./memory.ts";
import type { DecisionNotice } from "./notice.ts";

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

/** What the model answered to one choice question: its pick and the probability of every option. */
export interface QuestionAnswer {
  choice: string;
  probabilities: Record<string, number>;
}

/** Controller forecast for people to see; never input, memory or an episode record. */
export interface RoutePreview {
  /** Column at the observation's row; rows in steps are relative to that row. */
  col: number;
  steps: readonly { action: Action; col: number; dz: number }[];
  /** The continuation depends on a crossing clearing, at an unknown time. */
  conditional?: boolean;
}

export interface Decision {
  action: Action;
  preview?: RoutePreview;
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
   * Who made the move. A model's answer is the default; `executor` marks a step the code took inside a
   * manoeuvre the model had chosen, which asked the model nothing and cost nothing (ADR-0010).
   */
  source?: "model" | "executor";
  /** In a sentence, what happened, for the log and the inspector (executor steps). */
  note?: string;
  /** Language-neutral companion to note; presentation only, never model input. */
  notice?: DecisionNotice;
  /**
   * What the model read to give this answer. For people to look at (the app shows it); the episode
   * records do not keep it.
   */
  sent?: ModelInput;
  /**
   * The answer to each choice question as the model gave it, by question id. `probabilities` above is the
   * joint over the five moves the strategy implies; this is the raw material, so a person can see which
   * answer led to which move. Like `sent`, the episode records do not keep it.
   */
  answers?: Record<string, QuestionAnswer>;
}

/**
 * Callbacks a caller may hand to `decide` to follow a decision while it happens. They only observe: a
 * policy behaves the same without them.
 */
export interface DecideHooks {
  /**
   * Called with the exact request just before it goes to the model, and not at all for a step the code
   * takes by itself or an answer that needs no model. The answer follows in the returned `Decision`.
   */
  onAsk?(input: ModelInput): void;
}

/**
 * Sees only the `Observation` and what the player remembers (ADR-0005, ADR-0009). The type is the
 * guard: a policy of this kind cannot get hold of the simulator, so it cannot peek at information the
 * fairness rule excludes.
 */
export interface ObservationPolicy {
  readonly kind: "observation";
  readonly id: string;
  decide(obs: Observation, memory?: Memory, hooks?: DecideHooks): Promise<Decision>;
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
