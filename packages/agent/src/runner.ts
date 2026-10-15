import {
  type Action,
  DECISION_TICKS,
  type DeathCause,
  Game,
  type MoveOutcome,
  type ObserveWindow,
  observe,
  TICKS_PER_SECOND,
} from "@ccr/core";
import { emptyMemory, type Memory, remember } from "./memory.ts";
import type { Decision, Policy, PolicyFactory } from "./policy.ts";

export const DEFAULT_MAX_DECISIONS = 300;
export const DEFAULT_STALL_LIMIT = 40;

export interface EpisodeOptions {
  /** Ticks the world advances after each action. Default: one full hop (12). */
  decisionTicks?: number;
  /** Safety cap on decisions per episode. Default 300. */
  maxDecisions?: number;
  /**
   * End the episode when this many consecutive decisions pass without reaching a new furthest row.
   * A benchmark rule applied to every policy alike; it also bounds the cost of a policy that
   * dithers forever. Default 40; 0 disables it.
   */
  stallLimit?: number;
  /**
   * How long the world keeps running while the policy "thinks". The observation is taken first,
   * then the world advances by the latency, then the (now stale) action is applied. Deterministic:
   * `fixed` uses a constant, `recorded` replays the latency stored with each cached model answer.
   */
  latency?: LatencyModel;
  observeWindow?: ObserveWindow;
}

/**
 * serial (default): the policy is asked, the world runs for the latency with the hero idle, then the
 *   action is applied and its hop plays out. Cadence = latency + hop.
 * pipelined: like the desktop app in real-time mode. The next question is asked as soon as an action
 *   is applied, so the hop plays out WHILE the model thinks; the hero idles only if the answer takes
 *   longer than the hop. Cadence = max(latency, hop). An action that arrives mid-hop waits in the
 *   game's input queue and starts when that hop lands.
 */
export type LatencyModel =
  | { kind: "none" }
  | { kind: "fixed"; ms: number; pipelined?: boolean }
  | { kind: "recorded"; pipelined?: boolean };

const msToTicks = (ms: number): number => Math.max(0, Math.round((ms * TICKS_PER_SECOND) / 1000));

export const isPipelined = (latency: LatencyModel | undefined): boolean =>
  latency !== undefined && latency.kind !== "none" && latency.pipelined === true;

export interface ApplyOptions {
  /** Ticks the world ran while the policy was thinking. */
  waitedTicks: number;
  pipelined: boolean;
  decisionTicks: number;
}

/**
 * How one decision changes the world: the ticks spent waiting for the answer, then the action
 * (serial: its hop plays out now; pipelined: during the next wait). The runner and every replay of a
 * stored episode go through this, so a replay cannot drift from the game the policy actually saw.
 */
export function applyDecision(
  game: Game,
  action: Action,
  { waitedTicks, pipelined, decisionTicks }: ApplyOptions,
): MoveOutcome {
  if (waitedTicks > 0) game.advance(waitedTicks);
  return pipelined ? game.act(action) : game.step(action, decisionTicks).outcome;
}

export interface DecisionRecord {
  index: number;
  tick: number;
  row: number;
  action: Action;
  outcome: MoveOutcome;
  /** Ticks the world ran between the observation and the action (latency injection). */
  waitedTicks?: number;
  probabilities?: Decision["probabilities"];
  confidence?: number;
  latencyMs?: number;
  inputTokens?: number;
  neurons?: number;
  cached?: boolean;
  /** Set only for steps the executor took inside a manoeuvre the model chose. */
  source?: "model" | "executor";
  extra?: Record<string, unknown>;
}

export interface EpisodeResult {
  policy: string;
  seed: number;
  /** Furthest row reached, minus the starting row (the game's own score). */
  score: number;
  decisions: number;
  alive: boolean;
  deathCause: DeathCause | null;
  invalidMoves: number;
  ticks: number;
  /** True if the episode ended because it hit `maxDecisions` while still alive. */
  capped: boolean;
  /** True if the episode ended because `stallLimit` decisions passed without progress. */
  stalled: boolean;
  actions: Action[];
  records: DecisionRecord[];
}

/** Plays one game to the end (death or cap) with one policy. Errors from a policy propagate. */
export async function playEpisode(
  factory: PolicyFactory,
  seed: number,
  options: EpisodeOptions = {},
): Promise<EpisodeResult> {
  const decisionTicks = options.decisionTicks ?? DECISION_TICKS;
  const maxDecisions = options.maxDecisions ?? DEFAULT_MAX_DECISIONS;
  const stallLimit = options.stallLimit ?? DEFAULT_STALL_LIMIT;
  const game = new Game({ seed });
  const policy = factory.create(seed);
  const pipelined = isPipelined(options.latency);
  const records: DecisionRecord[] = [];
  const actions: Action[] = [];
  let memory = emptyMemory();
  let stalled = false;

  while (game.alive && records.length < maxDecisions && !stalled) {
    const decision = await decide(policy, game, options.observeWindow, memory);
    const tick = game.tick;
    const row = game.heroRow;
    // Pipelined: at least one tick must pass per decision, or time would never advance.
    const waited = Math.max(pipelined ? 1 : 0, latencyTicks(options.latency, decision));
    const outcome = applyDecision(game, decision.action, {
      waitedTicks: waited,
      pipelined,
      decisionTicks,
    });
    actions.push(decision.action);
    records.push(toRecord(records.length, tick, row, decision, outcome, waited));
    memory = remember(memory, { action: decision.action, outcome }, game.score);
    stalled = stallLimit > 0 && memory.sinceProgress >= stallLimit;
  }

  return {
    policy: factory.id,
    seed,
    score: game.score,
    decisions: records.length,
    alive: game.alive,
    deathCause: game.deathCause,
    invalidMoves: game.invalidMoves,
    ticks: game.tick,
    capped: game.alive && !stalled,
    stalled: game.alive && stalled,
    actions,
    records,
  };
}

function decide(
  policy: Policy,
  game: Game,
  view: ObserveWindow | undefined,
  memory: Memory,
): Promise<Decision> {
  return policy.kind === "oracle"
    ? policy.decide(game)
    : policy.decide(observe(game, view), memory);
}

function latencyTicks(latency: LatencyModel | undefined, decision: Decision): number {
  if (!latency || latency.kind === "none") return 0;
  if (latency.kind === "fixed") return msToTicks(latency.ms);
  return msToTicks(decision.latencyMs ?? 0);
}

function toRecord(
  index: number,
  tick: number,
  row: number,
  decision: Decision,
  outcome: MoveOutcome,
  waited: number,
): DecisionRecord {
  const record: DecisionRecord = { index, tick, row, action: decision.action, outcome };
  if (waited > 0) record.waitedTicks = waited;
  if (decision.probabilities) record.probabilities = decision.probabilities;
  if (decision.confidence !== undefined) record.confidence = decision.confidence;
  if (decision.latencyMs !== undefined) record.latencyMs = decision.latencyMs;
  if (decision.inputTokens !== undefined) record.inputTokens = decision.inputTokens;
  if (decision.neurons !== undefined) record.neurons = decision.neurons;
  if (decision.cached !== undefined) record.cached = decision.cached;
  if (decision.source === "executor") record.source = decision.source;
  if (decision.extra) record.extra = decision.extra;
  return record;
}
