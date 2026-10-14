import type { Decision, Policy, PolicyFactory } from "@ccr/agent";
import {
  type Action,
  DECISION_TICKS,
  type DeathCause,
  Game,
  observe,
  TICKS_PER_SECOND,
} from "@ccr/core";

/**
 * step:     the world waits while the policy thinks, exactly like the benchmark.
 * realtime: the world keeps running at 60 Hz; the action lands whenever the answer arrives.
 */
export type Timing = "step" | "realtime";

/** idle: waiting to ask. thinking: an answer is in flight. hopping: playing out the hop. */
export type Phase = "idle" | "thinking" | "hopping" | "error";

export interface DecisionLog {
  index: number;
  tick: number;
  row: number;
  action: Action;
  decision: Decision;
  /** Wall-clock time the policy took, ms (network round trip for models). */
  wallMs: number;
}

export interface SessionState {
  seed: number;
  tick: number;
  score: number;
  best: number;
  alive: boolean;
  deathCause: DeathCause | null;
  invalidMoves: number;
  decisions: number;
  phase: Phase;
  error: string | null;
  paused: boolean;
  speed: number;
  timing: Timing;
  /** Human control (no policy selected). */
  human: boolean;
  policyId: string | null;
  last: DecisionLog | null;
  history: readonly DecisionLog[];
  /** Mean wall-clock decision time over the decisions that were not served from the cache. */
  avgLatencyMs: number | null;
  /** Mean input tokens over decisions that reported them. */
  avgTokens: number | null;
  /** Neurons charged during this episode. */
  neurons: number;
  cacheHits: number;
}

const HISTORY = 14;

export class Session {
  game: Game;
  private seed = 1;
  private epoch = 0;
  private acc = 0;
  private factory: PolicyFactory | null = null;
  private policy: Policy | null = null;
  private timing: Timing = "step";
  private phase: Phase = "idle";
  private inFlight = false;
  private hopTicksLeft = 0;
  private paused = false;
  private singleStep = false;
  private speed = 1;
  private error: string | null = null;
  private best = 0;
  private decisions = 0;
  private history: DecisionLog[] = [];
  private last: DecisionLog | null = null;
  private latencySum = 0;
  private latencyN = 0;
  private tokenSum = 0;
  private tokenN = 0;
  private neurons = 0;
  private cacheHits = 0;
  private readonly listeners = new Set<() => void>();
  private readonly decisionTicks: number;
  private readonly now: () => number;

  constructor(options: { decisionTicks?: number; now?: () => number } = {}) {
    this.decisionTicks = options.decisionTicks ?? DECISION_TICKS;
    this.now = options.now ?? (() => performance.now());
    this.game = new Game({ seed: this.seed });
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  /** Starts a fresh episode on `seed` with the current policy. In-flight answers are discarded. */
  start(seed: number): void {
    this.epoch++;
    this.seed = seed >>> 0;
    this.game = new Game({ seed: this.seed });
    this.policy = this.factory ? this.factory.create(this.seed) : null;
    this.acc = 0;
    this.inFlight = false;
    this.hopTicksLeft = 0;
    this.phase = "idle";
    this.error = null;
    this.singleStep = false;
    this.decisions = 0;
    this.history = [];
    this.last = null;
    this.latencySum = this.latencyN = this.tokenSum = this.tokenN = 0;
    this.neurons = this.cacheHits = 0;
    this.emit();
  }

  setPolicy(factory: PolicyFactory | null): void {
    this.factory = factory;
    this.start(this.seed);
  }

  setTiming(timing: Timing): void {
    this.timing = timing;
    this.start(this.seed);
  }

  setSpeed(speed: number): void {
    this.speed = Math.max(0.1, Math.min(8, speed));
    this.emit();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.emit();
  }

  togglePause(): void {
    this.setPaused(!this.paused);
  }

  /** Runs exactly one decision (and its hop) while paused. */
  stepOnce(): void {
    if (!this.policy || this.timing !== "step" || !this.game.alive) return;
    if (this.phase !== "idle") return;
    this.singleStep = true;
    this.emit();
  }

  /** Human control. Ignored while a policy is playing. */
  humanInput(action: Action): void {
    if (this.factory || !this.game.alive || this.paused) return;
    this.game.act(action);
    this.decisions++;
    this.best = Math.max(this.best, this.game.score);
    this.emit();
  }

  /**
   * Advances the session by `dt` real seconds. Returns the fraction of the next tick that has
   * elapsed (for render interpolation).
   */
  frame(dt: number): number {
    if (!this.game.alive) return 0;
    const mayRun = !this.paused || this.singleStep;
    if (!mayRun) return 0;

    this.driveAi();
    if (!this.worldRuns()) {
      this.acc = 0;
      return 0;
    }

    this.acc += Math.min(dt, 0.1) * this.speed * TICKS_PER_SECOND;
    let ticks = Math.floor(this.acc);
    this.acc -= ticks;

    if (this.policy && this.timing === "step") ticks = Math.min(ticks, this.hopTicksLeft);
    const before = this.game.score;
    for (let i = 0; i < ticks && this.game.alive; i++) {
      this.game.advance(1);
      if (this.hopTicksLeft > 0) this.hopTicksLeft--;
    }

    if (
      this.policy &&
      this.timing === "step" &&
      this.phase === "hopping" &&
      this.hopTicksLeft === 0
    ) {
      this.phase = "idle";
      this.acc = 0;
      if (this.singleStep) {
        this.singleStep = false;
        this.paused = true;
      }
    }
    if (this.game.score !== before) this.best = Math.max(this.best, this.game.score);
    if (!this.game.alive) this.emit();
    return this.acc;
  }

  state(): SessionState {
    return {
      seed: this.seed,
      tick: this.game.tick,
      score: this.game.score,
      best: Math.max(this.best, this.game.score),
      alive: this.game.alive,
      deathCause: this.game.deathCause,
      invalidMoves: this.game.invalidMoves,
      decisions: this.decisions,
      phase: this.phase,
      error: this.error,
      paused: this.paused,
      speed: this.speed,
      timing: this.timing,
      human: this.factory === null,
      policyId: this.policy?.id ?? null,
      last: this.last,
      history: this.history,
      avgLatencyMs: this.latencyN > 0 ? this.latencySum / this.latencyN : null,
      avgTokens: this.tokenN > 0 ? this.tokenSum / this.tokenN : null,
      neurons: this.neurons,
      cacheHits: this.cacheHits,
    };
  }

  // ------------------------------------------------------------------------------------------

  private worldRuns(): boolean {
    if (!this.policy) return true; // human
    if (this.phase === "error") return false;
    if (this.timing === "realtime") return true;
    return this.phase === "hopping";
  }

  private driveAi(): void {
    const policy = this.policy;
    if (!policy || this.inFlight || this.phase === "error") return;
    if (this.timing === "step" && this.phase !== "idle") return;
    if (this.paused && !this.singleStep) return;
    this.requestDecision(policy);
  }

  private requestDecision(policy: Policy): void {
    const epoch = this.epoch;
    this.inFlight = true;
    if (this.timing === "step") this.phase = "thinking";
    const started = this.now();
    const asked =
      policy.kind === "oracle" ? policy.decide(this.game) : policy.decide(observe(this.game));

    asked.then(
      (decision) => {
        if (epoch !== this.epoch) return; // the episode was restarted meanwhile
        this.inFlight = false;
        if (!this.game.alive) return;
        this.apply(decision, this.now() - started);
      },
      (error: unknown) => {
        if (epoch !== this.epoch) return;
        this.inFlight = false;
        this.phase = "error";
        this.error = error instanceof Error ? error.message : String(error);
        this.emit();
      },
    );
  }

  private apply(decision: Decision, wallMs: number): void {
    const tick = this.game.tick;
    const row = this.game.heroRow;
    this.game.act(decision.action);

    const log: DecisionLog = {
      index: this.decisions,
      tick,
      row,
      action: decision.action,
      decision,
      wallMs,
    };
    this.decisions++;
    this.last = log;
    this.history = [...this.history.slice(-(HISTORY - 1)), log];

    if (decision.cached) this.cacheHits++;
    else if (decision.latencyMs !== undefined) {
      this.latencySum += wallMs;
      this.latencyN++;
    }
    if (decision.inputTokens !== undefined) {
      this.tokenSum += decision.inputTokens;
      this.tokenN++;
    }
    this.neurons += decision.neurons ?? 0;

    if (this.timing === "step") {
      this.phase = "hopping";
      this.hopTicksLeft = this.decisionTicks;
    }
    this.emit();
  }
}
