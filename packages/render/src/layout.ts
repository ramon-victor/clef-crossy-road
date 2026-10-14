/**
 * Pure presentation math: nothing here touches WebGL, so it is unit-tested.
 * Numbers come from the bounding boxes of Expo-Crossy-Road's models and from its camera/hero code.
 */

/** Height of the top surface of each floor model (bounding-box max.y of the .obj files). */
export const ROW_TOP = {
  grass: 0.375,
  road: 0.25,
  water: 0.125,
  rail: 0.5,
} as const;

export type FloorKind = keyof typeof ROW_TOP;

/** Vertical offsets where entities sit on their floor (Expo-Crossy-Road row classes). */
export const ENTITY_Y = {
  tree: 0.4,
  car: 0.25,
  log: -0.1,
  lilyPad: 0.125,
  train: 0.4,
} as const;

/** Hero standing height when carried by a platform (platform top + the hero's rest offset). */
export const PLATFORM_TOP = {
  log: 0.4,
  lilyPad: 0.25,
} as const;

/** Sunk-in-water height of a drowned hero. */
export const DROWNED_Y = -0.2;

/** Upstream moves the camera 3% of the remaining distance every 60 Hz frame. */
export const FOLLOW_PER_FRAME = 0.03;
export const FOLLOW_RATE_PER_SECOND = -Math.log(1 - FOLLOW_PER_FRAME) * 60;

/** Frame-rate independent exponential smoothing factor in [0, 1). */
export function followFactor(dtSeconds: number, rate = FOLLOW_RATE_PER_SECOND): number {
  return 1 - Math.exp(-Math.max(0, dtSeconds) * rate);
}

/** Camera x target in upstream's axis (GameEngine.forwardScene clamps to [-3, 2]). */
export function cameraTargetX(heroX: number): number {
  return Math.max(-3, Math.min(2, -heroX));
}

/** Parabolic jump: 0 on the ground at p = 0 and p = 1, `height` at the apex. */
export function hopArc(progress: number, height = 0.5): number {
  const p = Math.max(0, Math.min(1, progress));
  return 4 * height * p * (1 - p);
}

/** Squash and stretch over a hop, as a multiplier on the hero's height (1 at rest). */
export function hopStretch(progress: number): number {
  const p = Math.max(0, Math.min(1, progress));
  return 1 + 0.18 * Math.sin(p * Math.PI);
}

/** Facing of the hero for a hop of (dx, dz) in upstream's axes (CrossyGame.moveWithDirection). */
export function facingFor(dx: number, dz: number, current: number): number {
  if (Math.abs(dz) >= Math.abs(dx) && dz !== 0) return dz > 0 ? 0 : Math.PI;
  if (dx > 0) return Math.PI / 2;
  if (dx < 0) return -Math.PI / 2;
  return current;
}

/** Signed shortest rotation from angle `from` to angle `to`, in (-PI, PI]. */
export function shortestAngle(from: number, to: number): number {
  let d = (to - from) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

/** Interpolated hero y: floor height blended across the row boundary plus the jump arc. */
export function heroY(base: number, hopProgress: number | null): number {
  return base + (hopProgress === null ? 0 : hopArc(hopProgress));
}

/** Which of the two alternating warning lights is lit (RailRoad.ringLight toggles every 200 ms). */
export function trainLightPhase(tick: number): 0 | 1 {
  return (Math.floor(tick / 12) % 2) as 0 | 1;
}
