import {
  DEFAULT_STALL_LIMIT,
  type Decision,
  emptyMemory,
  type Memory,
  type ModelInput,
  type Policy,
  type PolicyFactory,
  type RememberedMove,
  remember,
} from "@ccr/agent";
import {
  type Action,
  DECISION_TICKS,
  type DeathCause,
  Game,
  type MoveOutcome,
  observe,
  TICKS_PER_SECOND,
} from "@ccr/core";
import { type ErrorInfo, errorInfo } from "./bridge/errors.ts";
import { EpisodeStats } from "./episode-stats.ts";

/**
 * step:     the world waits while the policy thinks, exactly like the benchmark.
 * realtime: the world keeps running at 60 Hz; the action lands whenever the answer arrives.
 */
export type Timing = "step" | "realtime";

/**
 * idle: waiting to ask. thinking: an answer is in flight. reading: the model has answered and the move is held
 * for a moment so a person can read it (see `setLinger`). hopping: playing out the hop.
 */
export type Phase = "idle" | "thinking" | "reading" | "hopping" | "error";

export interface DecisionLog {
  index: number;
  tick: number;
  row: number;
  action: Action;
  decision: Decision;
  /** Wall-clock time the policy took, ms (network round trip for models). */
  wallMs: number;
  /** Display-only origin captured before the policy reads the world, including network delay. */
  observed?: { tick: number; row: number };
}

/** A request on its way to the model: what it was sent, and when (in the session's clock). */
export interface Asking {
  /** Player row when the request was sent (display only). */
  row?: number;
  input: ModelInput;
  since: number;
}

/** One question to the model and what the controller did with the answer, for the conversation view. */
export interface Turn {
  model: DecisionLog;
  steps: DecisionLog[];
}

export interface SessionState {
  /** Generation of this episode, including retries of the same seed. Display identity only. */
  episode: number;
  seed: number;
  tick: number;
  score: number;
  best: number;
  alive: boolean;
  deathCause: DeathCause | null;
  /** A policy went `DEFAULT_STALL_LIMIT` decisions without reaching a new row, so the game stopped. */
  stalled: boolean;
  invalidMoves: number;
  decisions: number;
  phase: Phase;
  error: string | null;
  errorInfo: ErrorInfo | null;
  paused: boolean;
  speed: number;
  timing: Timing;
  /** Human control (no policy selected). */
  human: boolean;
  policyId: string | null;
  last: DecisionLog | null;
  /** Result of applying the latest released decision, never a held answer. */
  playback?: { index: number; outcome: MoveOutcome } | null;
  history: readonly DecisionLog[];
  /**
   * The request the model is reading right now, from the moment it goes out until the answer lands. Set
   * for any timing and only for real model calls: a step the controller takes itself never shows here.
   */
  asking: Asking | null;
  /** The last decision that came from the model (not a controller step), kept however long a detour runs. */
  lastModel: DecisionLog | null;
  /** Controller steps taken since `lastModel`. */
  stepsSinceModel: number;
  /** The last few questions to the model, oldest first, each with the controller steps that followed it. */
  turns: readonly Turn[];
  /** Mean wall-clock decision time over the decisions that were not served from the cache. */
  avgLatencyMs: number | null;
  /** Mean input tokens over decisions that reported them. */
  avgTokens: number | null;
  /** Neurons charged during this episode. */
  neurons: number;
  cacheHits: number;
}

/**
 * What happens in a game, for whoever wants to follow it without polling the state (the terminal log).
 * `decision` is only sent for policies, not for a person at the keyboard.
 */
export type SessionEvent =
  | { type: "start"; seed: number; policyId: string | null; timing: Timing }
  | { type: "decision"; seed: number; policyId: string | null; log: DecisionLog }
  | { type: "end"; state: SessionState };

const HISTORY = 14;
/** How many questions to the model are kept for the conversation, and how many controller steps of each. */
const TURNS = 6;
/** More than the longest manoeuvre: a crossing waits up to 15 steps for a gap and a detour walks up to 12 hops. */
const TURN_STEPS = 24;

/** A step the model spent waiting for a gap (`route-live`): its own decision, asked again at every step. */
const liveWait = (decision: Decision): boolean =>
  decision.extra?.live === true &&
  (decision.extra.controller as { kind?: unknown } | undefined)?.kind === "wait";

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
  private memory: Memory = emptyMemory();
  /** The last move, until the world has played it out and the memory can say what it led to. */
  private pendingMove: RememberedMove | null = null;
  private stalled = false;
  private paused = false;
  private singleStep = false;
  private speed = 1;
  /** How long, in ms, a model's move is held after it answers, for a person to read it (step timing only). */
  private lingerMs = 0;
  /**
   * A model's move that has been answered and shown, and will be played at `playAt`. It is counted (statistics,
   * the log of the terminal) only when it is played, so a game that is restarted meanwhile never counts a move it
   * did not make.
   */
  private held: { log: DecisionLog; playAt: number } | null = null;
  private error: string | null = null;
  private errorInfo: ErrorInfo | null = null;
  private best = 0;
  private decisions = 0;
  private history: DecisionLog[] = [];
  private last: DecisionLog | null = null;
  private playback: Exclude<SessionState["playback"], undefined> = null;
  private asking: Asking | null = null;
  private lastModel: DecisionLog | null = null;
  private stepsSinceModel = 0;
  private turns: Turn[] = [];
  private stats = new EpisodeStats();
  private readonly listeners = new Set<() => void>();
  private readonly eventListeners = new Set<(event: SessionEvent) => void>();
  private endReported = false;
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

  /** Calls `listener` for every start, decision and end of a game. Returns how to stop. */
  subscribeEvents(listener: (event: SessionEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  private announce(event: SessionEvent): void {
    for (const l of this.eventListeners) l(event);
  }

  /** The game is over (it died, or a policy stopped getting anywhere): said once per game. */
  private reportEnd(): void {
    if (this.endReported) return;
    this.endReported = true;
    this.announce({ type: "end", state: this.state() });
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
    this.memory = emptyMemory();
    this.pendingMove = null;
    this.stalled = false;
    this.phase = "idle";
    this.error = null;
    this.errorInfo = null;
    this.singleStep = false;
    this.decisions = 0;
    this.history = [];
    this.last = null;
    this.playback = null;
    this.asking = null;
    this.lastModel = null;
    this.stepsSinceModel = 0;
    this.turns = [];
    this.held = null;
    this.stats = new EpisodeStats();
    this.endReported = false;
    this.emit();
    this.announce({
      type: "start",
      seed: this.seed,
      policyId: this.policy?.id ?? null,
      timing: this.timing,
    });
  }

  /** Changes who plays and starts a new game on `seed` (the current one by default). */
  setPolicy(factory: PolicyFactory | null, seed: number = this.seed): void {
    this.factory = factory;
    this.start(seed);
  }

  setTiming(timing: Timing): void {
    this.timing = timing;
    this.start(this.seed);
  }

  setSpeed(speed: number): void {
    this.speed = Math.max(0.1, Math.min(8, speed));
    this.emit();
  }

  /**
   * Holds each answer of the model for this long (real milliseconds, shorter at higher speed) before the
   * chicken makes the move, so a person can read it. Only in step timing, where the world already waits
   * for the model: the game plays out exactly the same, it just takes longer. The answer is on record the
   * moment it lands; the controller's own steps are never held.
   */
  setLinger(ms: number): void {
    this.lingerMs = Math.max(0, ms);
    if (this.lingerMs === 0 && this.held) this.held.playAt = 0;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) this.singleStep = false;
    this.emit();
  }

  togglePause(): void {
    this.setPaused(!this.paused);
  }

  /** Runs exactly one decision (and its hop) while paused. */
  stepOnce(): void {
    if (!this.stepMode || !this.game.alive || this.phase !== "idle") return;
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
    if (!this.game.alive || this.stalled || (this.paused && !this.singleStep)) return 0;

    this.releaseHeld();
    this.driveAi();
    if (!this.worldRuns()) {
      this.acc = 0;
      return 0;
    }

    this.acc += Math.min(dt, 0.1) * this.speed * TICKS_PER_SECOND;
    let ticks = Math.floor(this.acc);
    this.acc -= ticks;

    if (this.stepMode) ticks = Math.min(ticks, this.hopTicksLeft);
    this.advance(ticks);
    if (this.stepMode && this.phase === "hopping" && this.hopTicksLeft === 0) this.finishHop();

    this.best = Math.max(this.best, this.game.score);
    if (!this.game.alive) {
      this.emit();
      this.reportEnd();
    }
    return this.acc;
  }

  state(): SessionState {
    return {
      episode: this.epoch,
      seed: this.seed,
      tick: this.game.tick,
      score: this.game.score,
      best: Math.max(this.best, this.game.score),
      alive: this.game.alive,
      deathCause: this.game.deathCause,
      stalled: this.stalled,
      invalidMoves: this.game.invalidMoves,
      decisions: this.decisions,
      phase: this.phase,
      error: this.error,
      errorInfo: this.errorInfo,
      paused: this.paused,
      speed: this.speed,
      timing: this.timing,
      human: this.factory === null,
      policyId: this.policy?.id ?? null,
      last: this.last,
      playback: this.playback,
      history: this.history,
      asking: this.asking,
      lastModel: this.lastModel,
      stepsSinceModel: this.stepsSinceModel,
      turns: this.turns,
      avgLatencyMs: this.stats.avgLatencyMs,
      avgTokens: this.stats.avgTokens,
      neurons: this.stats.neurons,
      cacheHits: this.stats.cacheHits,
    };
  }

  /** A policy plays and the world waits for it between decisions. */
  private get stepMode(): boolean {
    return this.policy !== null && this.timing === "step";
  }

  private worldRuns(): boolean {
    if (!this.policy) return true; // human
    if (this.phase === "error") return false;
    if (this.timing === "realtime") return true;
    return this.phase === "hopping";
  }

  private advance(ticks: number): void {
    for (let i = 0; i < ticks && this.game.alive; i++) {
      this.game.advance(1);
      if (this.hopTicksLeft > 0) this.hopTicksLeft--;
    }
  }

  private finishHop(): void {
    this.phase = "idle";
    this.acc = 0;
    if (this.singleStep) {
      this.singleStep = false;
      this.paused = true;
    }
  }

  private driveAi(): void {
    const policy = this.policy;
    if (!policy || this.inFlight || this.phase === "error") return;
    if (this.stepMode && this.phase !== "idle") return;
    if (this.paused && !this.singleStep) return;
    this.settleLastMove();
    if (this.stalled) {
      this.emit();
      this.reportEnd();
      return;
    }
    this.requestDecision(policy);
  }

  /**
   * Once the last move has played out, the player remembers what it did. The same rule the benchmark
   * ends a game on applies here: too many decisions without a new row and the game is over, so a policy
   * that keeps bumping into the same tree cannot ask (and spend) for ever.
   */
  private settleLastMove(): void {
    if (this.pendingMove) {
      this.memory = remember(this.memory, this.pendingMove, this.game.score, this.game.heroRow);
      this.pendingMove = null;
    }
    this.stalled = this.memory.sinceProgress >= DEFAULT_STALL_LIMIT;
  }

  private requestDecision(policy: Policy): void {
    const epoch = this.epoch;
    this.inFlight = true;
    if (this.stepMode) this.phase = "thinking";
    const started = this.now();
    const observed = { tick: this.game.tick, row: this.game.heroRow };
    const asked =
      policy.kind === "oracle"
        ? policy.decide(this.game)
        : policy.decide(observe(this.game), this.memory, {
            onAsk: (input) => {
              if (epoch !== this.epoch) return;
              this.asking = { input, since: this.now(), row: this.game.heroRow };
              this.emit();
            },
          });

    asked.then(
      (decision) => {
        if (epoch !== this.epoch) return; // the episode was restarted meanwhile
        this.inFlight = false;
        this.asking = null;
        if (!this.game.alive) return;
        this.apply(decision, this.now() - started, observed);
      },
      (error: unknown) => {
        if (epoch !== this.epoch) return;
        this.inFlight = false;
        this.asking = null;
        this.phase = "error";
        this.error = error instanceof Error ? error.message : String(error);
        this.errorInfo = errorInfo(error);
        this.emit();
      },
    );
  }

  private apply(
    decision: Decision,
    wallMs: number,
    observed: NonNullable<DecisionLog["observed"]>,
  ): void {
    const tick = this.game.tick;
    const row = this.game.heroRow;
    const linger = this.lingerFor(decision);
    if (linger === 0) this.play(decision);

    // The answer is on record and on screen at once, even while the move is held for reading (see `held`):
    // `go` tells the screen what has been let go. A restart clears all of it, so nothing outlives a move that
    // was never played.
    const log: DecisionLog = {
      index: this.decisions,
      tick,
      row,
      action: decision.action,
      decision,
      wallMs,
      observed,
    };
    this.decisions++;
    this.last = log;
    if (decision.source === "executor") {
      this.stepsSinceModel++;
      const open = this.turns.at(-1);
      if (open && open.steps.length < TURN_STEPS) {
        this.turns = [...this.turns.slice(0, -1), { ...open, steps: [...open.steps, log] }];
      }
    } else if (decision.sent) {
      this.lastModel = log;
      this.stepsSinceModel = 0;
      this.turns = [...this.turns.slice(-(TURNS - 1)), { model: log, steps: [] }];
    }
    this.history = [...this.history.slice(-(HISTORY - 1)), log];

    if (linger > 0) {
      this.held = { log, playAt: this.now() + linger };
      this.phase = "reading";
    } else {
      this.count(log);
    }
    this.emit();
  }

  /** The move is made: it enters the statistics and is told to whoever follows the game. */
  private count(log: DecisionLog): void {
    this.stats.add(log.decision, log.wallMs);
    this.announce({ type: "decision", seed: this.seed, policyId: this.policy?.id ?? null, log });
  }

  /** How long this answer is held before it is played: only a model's, and only while the world waits for it. */
  private lingerFor(decision: Decision): number {
    const asked = decision.source !== "executor" && decision.sent !== undefined;
    // A model that waits for a gap is asked again every step: reading each of those answers would stop the game.
    const again = liveWait(decision) && this.last !== null && liveWait(this.last.decision);
    return this.stepMode && asked && !again ? this.lingerMs / this.speed : 0;
  }

  /** The chicken makes the move. In step timing this starts the hop the next decision waits for. */
  private play(decision: Decision, index = this.decisions): void {
    const outcome = this.game.act(decision.action);
    this.playback = { index, outcome };
    this.pendingMove = { action: decision.action, outcome };
    if (this.timing === "step") {
      this.phase = "hopping";
      this.hopTicksLeft = this.decisionTicks;
    }
  }

  private releaseHeld(): void {
    if (!this.held || this.now() < this.held.playAt) return;
    const { log } = this.held;
    this.held = null;
    this.play(log.decision, log.index);
    this.count(log);
    this.emit();
  }
}
