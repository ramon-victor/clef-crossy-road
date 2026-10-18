import {
  DECISION_TICKS,
  HOP_AIR_FRACTION,
  HOP_HALF_TICKS,
  HOP_TICKS,
  MAX_ABS_X,
  MIN_Z,
  START_ROW,
} from "./constants.ts";
import { type Mover, moverWrapped, moverX, overlaps, trainLightOn } from "./mover.ts";
import type {
  Action,
  DeathCause,
  MoveOutcome,
  MoverSnapshot,
  RowSnapshot,
  Snapshot,
  SnapshotWindow,
  StepResult,
} from "./types.ts";
import { createRowGenerator, type RowGenerator, type RowSpec } from "./worldgen.ts";

export interface GameOptions {
  /** Unsigned 32-bit integer. Same seed => same map and same traffic. */
  readonly seed: number;
  /** Test hook: replaces the seeded generator with hand-built rows. */
  readonly generator?: RowGenerator;
}

interface Riding {
  readonly z: number;
  readonly index: number;
  readonly mover: Mover;
}

interface Hero {
  /** Collision position (upstream `hero.position`). It moves through the hop. */
  x: number;
  z: number;
  fromX: number;
  fromZ: number;
  targetX: number;
  targetZ: number;
  hopTick: number;
  moving: boolean;
  /** An input that arrived mid-hop. It starts on the tick that hop lands. */
  queued: Hop | null;
  ridingOn: Riding | null;
}

type Hop = Exclude<Action, "stay">;

/** Lazily generated, memoised rows. Rows are immutable, so clones can share one cache. */
class RowCache {
  private readonly rows = new Map<number, RowSpec>();
  private readonly generator: RowGenerator;

  constructor(generator: RowGenerator) {
    this.generator = generator;
  }

  get(z: number): RowSpec {
    const cached = this.rows.get(z);
    if (cached) return cached;
    // Row z depends on row z-1 (lily pads <-> grass), so fill any gap from below.
    let from = z;
    while (from > 0 && !this.rows.has(from - 1)) from--;
    for (let i = from; i <= z; i++) {
      this.rows.set(i, this.generator(i, this.rows.get(i - 1)));
    }
    return this.rows.get(z) as RowSpec;
  }

  peek(z: number): RowSpec | undefined {
    return z < 0 ? undefined : this.get(z);
  }
}

const easeOut = (p: number): number => p * (2 - p);

/** Position along one axis after `k` of the 12 hop ticks (GSAP default ease is Power1.easeOut). */
function hopAxis(from: number, to: number, k: number): number {
  const d = to - from;
  if (k <= HOP_HALF_TICKS) return from + d * HOP_AIR_FRACTION * easeOut(k / HOP_HALF_TICKS);
  return (
    from +
    d * HOP_AIR_FRACTION +
    d * (1 - HOP_AIR_FRACTION) * easeOut((k - HOP_HALF_TICKS) / HOP_HALF_TICKS)
  );
}

/**
 * Deterministic, headless Crossy Road. One `tick` is 1/60 s.
 *
 * Update order inside a tick mirrors upstream `Engine.tick`: hop animation, then the hazards of
 * the hero's row (rail, road, water), then riding/out-of-frame checks (only when not mid-hop),
 * then the input queued during the hop, if any, starts.
 */
export class Game {
  readonly seed: number;
  tick = 0;
  score = 0;
  invalidMoves = 0;
  alive = true;
  deathCause: DeathCause | null = null;

  private hero: Hero;
  private rows: RowCache;
  private readonly generator: RowGenerator;

  constructor(options: GameOptions) {
    this.seed = options.seed;
    this.generator = options.generator ?? createRowGenerator(options.seed);
    this.rows = new RowCache(this.generator);
    this.hero = {
      x: 0,
      z: START_ROW,
      fromX: 0,
      fromZ: START_ROW,
      targetX: 0,
      targetZ: START_ROW,
      hopTick: 0,
      moving: false,
      queued: null,
      ridingOn: null,
    };
  }

  get ended(): boolean {
    return !this.alive;
  }

  /** Cheap copy for look-ahead. Rows are immutable and shared. */
  clone(): Game {
    const copy = new Game({ seed: this.seed, generator: this.generator });
    copy.rows = this.rows;
    copy.tick = this.tick;
    copy.score = this.score;
    copy.invalidMoves = this.invalidMoves;
    copy.alive = this.alive;
    copy.deathCause = this.deathCause;
    copy.hero = { ...this.hero };
    return copy;
  }

  row(z: number): RowSpec | undefined {
    return this.rows.peek(z);
  }

  /** Row the hero is currently over (upstream rounds the tweened position). */
  get heroRow(): number {
    return Math.round(this.hero.z);
  }

  get heroX(): number {
    return this.hero.x;
  }

  get heroMoving(): boolean {
    return this.hero.moving;
  }

  get heroHopTicksLeft(): number {
    return this.hero.moving ? HOP_TICKS - this.hero.hopTick : 0;
  }

  get heroRiding(): boolean {
    return this.hero.ridingOn !== null;
  }

  /**
   * Applies an input immediately (GameEngine.moveWithDirection) without advancing time.
   * An input that arrives mid-hop waits in a one-slot queue (the last one wins) and starts on the
   * tick that hop lands, after the landing was checked. Upstream instead teleports the hero to the
   * end of the hop and keeps it "moving", so a fast key press skipped the water, car and train
   * checks of every row it chained through (docs/game-rules.md, D9).
   */
  act(action: Action): MoveOutcome {
    if (this.ended) return "ignored";
    if (action === "stay") return "stay";
    if (this.hero.moving) {
      this.hero.queued = action;
      return "queued";
    }
    return this.startHop(action);
  }

  private startHop(action: Hop): "hop" | "blocked" {
    const hero = this.hero;
    hero.ridingOn = null;

    let tx = hero.x;
    let tz = hero.z;
    switch (action) {
      case "hop_left":
        tx += 1;
        break;
      case "hop_right":
        tx -= 1;
        break;
      case "hop_forward":
        tz += 1;
        tx = Math.round(tx);
        break;
      case "hop_back":
        tz -= 1;
        tx = Math.round(tx);
        break;
    }

    if (this.treeCollision(tx, tz)) {
      this.invalidMoves++;
      hero.moving = false;
      return "blocked";
    }

    hero.fromX = hero.x;
    hero.fromZ = hero.z;
    hero.targetX = tx;
    hero.targetZ = tz;
    hero.hopTick = 0;
    hero.moving = true;
    return "hop";
  }

  /** Advances the world by `n` ticks (stops early on death). */
  advance(n: number): void {
    for (let i = 0; i < n && !this.ended; i++) this.tickOnce();
  }

  /** Applies `action`, then lets the world run for `ticks` (default: one full hop). */
  step(action: Action, ticks: number = DECISION_TICKS): StepResult {
    const before = this.tick;
    const outcome = this.act(action);
    this.advance(ticks);
    return {
      outcome,
      alive: this.alive,
      deathCause: this.deathCause,
      score: this.score,
      ticksAdvanced: this.tick - before,
    };
  }

  private tickOnce(): void {
    const hero = this.hero;
    const n = ++this.tick;

    if (hero.moving) {
      hero.hopTick++;
      hero.x = hopAxis(hero.fromX, hero.targetX, hero.hopTick);
      hero.z = hopAxis(hero.fromZ, hero.targetZ, hero.hopTick);
      if (hero.hopTick >= HOP_TICKS) this.completeHop();
    }

    this.updateHazards(n);
    if (this.ended) return;

    if (!hero.moving) {
      // Engine.tick: moveOnEntity(), then checkIfUserHasFallenOutOfFrame().
      if (hero.ridingOn) hero.x += hero.ridingOn.mover.speed;
      if (hero.z < MIN_Z || hero.x < -MAX_ABS_X || hero.x > MAX_ABS_X) this.die("out_of_bounds");

      const queued = hero.queued; // a death above has emptied it
      hero.queued = null;
      if (queued) this.startHop(queued);
    }
  }

  /** Finishes the hop in flight. Credits the score the way `updateScore` does at tween end. */
  private completeHop(): void {
    const hero = this.hero;
    hero.x = hero.targetX;
    hero.z = hero.targetZ;
    hero.hopTick = 0;
    hero.moving = false;
    this.score = Math.max(this.score, Math.max(Math.floor(hero.z) - START_ROW, 0));
  }

  /** The hazards of the row under the hero (RailRoad / Road / Water `update`). */
  private updateHazards(n: number): void {
    const hero = this.hero;
    const row = this.rows.peek(Math.round(hero.z));
    if (!row || this.ended) return;

    switch (row.kind) {
      case "rail": {
        const train = row.train;
        // Train hits only count when the hero is not mid-hop and the train did not just wrap.
        if (!hero.moving && !moverWrapped(train, n) && overlaps(train, moverX(train, n), hero.x)) {
          this.die("train");
        }
        return;
      }
      case "road": {
        for (const car of row.cars) {
          if (moverWrapped(car, n)) continue;
          if (overlaps(car, moverX(car, n), hero.x)) {
            this.die("car");
            return;
          }
        }
        return;
      }
      case "water": {
        if (hero.moving || hero.ridingOn) return;
        // Last overlapping platform wins, as upstream's `entities.map(shouldCheckCollision)`.
        row.items.forEach((item, index) => {
          if (overlaps(item, moverX(item, n), hero.x)) {
            hero.ridingOn = { z: row.z, index, mover: item };
          }
        });
        if (!hero.ridingOn) this.die("water");
        return;
      }
      case "grass":
        return;
    }
  }

  private die(cause: DeathCause): void {
    if (this.ended) return;
    this.alive = false;
    this.deathCause = cause;
    this.hero.moving = false; // Engine.gameOver: stop the hero finishing its movement
    this.hero.queued = null;
  }

  /** CrossyGameMap.treeCollision: truncates the target to integers, only grass rows block. */
  private treeCollision(x: number, z: number): boolean {
    const row = this.rows.peek(Math.trunc(z));
    if (row?.kind !== "grass") return false;
    return row.blocked.includes(Math.trunc(x));
  }

  snapshot(view: SnapshotWindow = {}): Snapshot {
    const behind = view.behind ?? 12;
    const ahead = view.ahead ?? 24;
    const center = this.heroRow;
    const rows: RowSnapshot[] = [];
    for (let z = Math.max(0, center - behind); z <= center + ahead; z++) {
      rows.push(this.snapshotRow(this.rows.get(z)));
    }
    const hero = this.hero;
    return {
      seed: this.seed,
      tick: this.tick,
      alive: this.alive,
      deathCause: this.deathCause,
      score: this.score,
      invalidMoves: this.invalidMoves,
      hero: {
        x: hero.x,
        z: hero.z,
        moving: hero.moving,
        hopTick: hero.hopTick,
        fromX: hero.fromX,
        fromZ: hero.fromZ,
        targetX: hero.targetX,
        targetZ: hero.targetZ,
        queued: hero.queued,
        ridingOn: hero.ridingOn ? { z: hero.ridingOn.z, index: hero.ridingOn.index } : null,
      },
      rows,
    };
  }

  private snapshotRow(row: RowSpec): RowSnapshot {
    const n = this.tick;
    const mover = (m: Mover): MoverSnapshot => ({
      kind: m.kind,
      variant: m.variant,
      width: m.width,
      halfExtent: m.halfExtent,
      x: moverX(m, n),
      speed: m.speed,
    });
    switch (row.kind) {
      case "grass":
        return { kind: "grass", z: row.z, blocked: row.blocked };
      case "road":
        return { kind: "road", z: row.z, movers: row.cars.map(mover) };
      case "water":
        return { kind: "water", z: row.z, flavor: row.flavor, movers: row.items.map(mover) };
      case "rail":
        return {
          kind: "rail",
          z: row.z,
          movers: [mover(row.train)],
          lightOn: trainLightOn(row.train, n),
        };
    }
  }
}
