import { halfExtentFor, TRAIN_LIGHT_TICKS } from "./constants.ts";

/**
 * Anything that slides along a row: cars, logs, lily pads (speed 0) and the train.
 *
 * Upstream steps every entity once per frame: `x += speed`, and when it passes the wrap offset
 * it jumps to the opposite edge (the overshoot is discarded). Because speed is constant, the
 * position after `n` updates has a closed form, so a row can be created at any time and still be
 * exactly where it would have been had it been simulated since tick 0. That makes the layout
 * independent of when (and by whom) a row is first looked at.
 */
export type MoverKind = "car" | "log" | "lily_pad" | "train";

export interface Mover {
  readonly kind: MoverKind;
  /** Model index for cars/logs; number of middle segments for the train; 0 for lily pads. */
  readonly variant: number;
  readonly width: number;
  /** Hero centre is lethal / carried when |hero.x - mover.x| < halfExtent. */
  readonly halfExtent: number;
  /** Tiles per tick, signed. +x is screen-left in upstream's camera. */
  readonly speed: number;
  readonly x0: number;
  readonly wrapOffset: number;
  /** Update number at which the first wrap happens (Infinity for static movers). */
  readonly firstWrapTick: number;
  /** Updates between wraps after the first one (Infinity for static movers). */
  readonly period: number;
}

export interface MoverInit {
  kind: MoverKind;
  variant: number;
  width: number;
  speed: number;
  x0: number;
  wrapOffset: number;
}

export function createMover(init: MoverInit): Mover {
  const { speed, x0, wrapOffset } = init;
  let firstWrapTick = Number.POSITIVE_INFINITY;
  let period = Number.POSITIVE_INFINITY;
  if (speed > 0) {
    firstWrapTick = Math.max(1, Math.floor((wrapOffset - x0) / speed) + 1);
    period = Math.floor((2 * wrapOffset) / speed) + 1;
  } else if (speed < 0) {
    firstWrapTick = Math.max(1, Math.floor((x0 + wrapOffset) / -speed) + 1);
    period = Math.floor((2 * wrapOffset) / -speed) + 1;
  }
  return {
    kind: init.kind,
    variant: init.variant,
    width: init.width,
    halfExtent: halfExtentFor(init.width),
    speed,
    x0,
    wrapOffset,
    firstWrapTick,
    period,
  };
}

/** Position after `n` updates (n = 0 is the initial position). */
export function moverX(m: Mover, n: number): number {
  if (n < m.firstWrapTick) return m.x0 + m.speed * n;
  const j = (n - m.firstWrapTick) % m.period;
  const start = m.speed > 0 ? -m.wrapOffset : m.wrapOffset;
  return start + m.speed * j;
}

/** True when update number `n` is the one that teleported the mover to the opposite edge. */
export function moverWrapped(m: Mover, n: number): boolean {
  return n >= m.firstWrapTick && (n - m.firstWrapTick) % m.period === 0;
}

/** Train warning light: on for 180 ticks after each wrap, off before the first wrap. */
export function trainLightOn(m: Mover, n: number): boolean {
  return n >= m.firstWrapTick && (n - m.firstWrapTick) % m.period < TRAIN_LIGHT_TICKS;
}

/** True when the hero's centre is inside the mover's hit zone. Strict inequalities, as upstream. */
export function overlaps(m: Mover, moverXNow: number, heroX: number): boolean {
  return heroX < moverXNow + m.halfExtent && heroX > moverXNow - m.halfExtent;
}
