/**
 * Constants ported from EvanBacon/Expo-Crossy-Road (MIT), revision 6f2e84e.
 * See NOTICE. The upstream file each value comes from is cited next to it.
 *
 * Coordinate convention (kept identical to upstream so the port can be checked line by line):
 *  - `z` is the row index and grows forward (towards the goal).
 *  - `x` is the column. Upstream's camera looks so that screen-LEFT is +x and screen-RIGHT is -x.
 *    Anything shown to an agent or a human flips this (`col = -x`), see observe.ts.
 *  - Speeds are in tiles per tick (upstream moves entities a fixed amount per rendered frame).
 */

/** Fixed simulation rate. Upstream is frame-locked and its frame loop assumes a 60 Hz display. */
export const TICKS_PER_SECOND = 60;

/** GameEngine.setupGame: `heroWidth: 0.7`. */
export const HERO_WIDTH = 0.7;

/** GameSettings.startingRow. The hero starts at x = 0, z = 8. */
export const START_ROW = 8;

/** CrossyGameMap.mapRowToObstacle: rows below 5 are `Fill.solid` (a wall of trees). */
export const SOLID_ROWS = 5;

/** CrossyGameMap.newRow: rows below 10 are forced to grass. */
export const FORCED_GRASS_ROWS = 10;

/** GameEngine.checkIfUserHasFallenOutOfFrame: the hero dies when |x| > 5. */
export const MAX_ABS_X = 5;

/** GameEngine.checkIfUserHasFallenOutOfFrame: `hero.z < camera.position.z - 1`, camera z is 1. */
export const MIN_Z = 0;

/** GameSettings.BASE_ANIMATION_TIME is 0.1 s and a hop is two tweens of that length. */
export const HOP_HALF_TICKS = 6;
export const HOP_TICKS = 2 * HOP_HALF_TICKS;

/** CrossyPlayer.PlayerPositionAnimation: the first tween covers 75% of the distance. */
export const HOP_AIR_FRACTION = 0.75;

/** Road.drive / Water.move: entities wrap at |x| > 11. */
export const WRAP_OFFSET = 11;

/** RailRoad.drive: `offset = 22 * 5`. */
export const TRAIN_WRAP_OFFSET = 110;

/** RailRoad: `speed: 0.8` per frame (48 tiles/s at 60 Hz). */
export const TRAIN_SPEED = 0.8;

/** RailRoad.ringLight: 15 toggles, one every 200 ms = 3 s. */
export const TRAIN_LIGHT_TICKS = 180;

/** Node/Car.ts model order. Width = Math.round(bounding-box z extent of the .obj). */
export const CAR_WIDTHS = [2, 1, 3, 2, 2, 2, 3, 2] as const;
export const CAR_NAMES = [
  "police_car",
  "blue_car",
  "blue_truck",
  "green_car",
  "orange_car",
  "purple_car",
  "red_truck",
  "taxi",
] as const;

/** Node/Log.ts models 0..3. Width = Math.round(bounding-box x extent): 1, 2, 3, 3.875 -> 4. */
export const LOG_WIDTHS = [1, 2, 3, 4] as const;

/** Lily pad bounding box is 0.5 wide and `Math.round(0.5)` is 1 in JavaScript. */
export const LILY_PAD_WIDTH = 1;

/**
 * Train length: front + n middles + back, segments spaced by round(width) = 5.
 * Extent = 5n + 9.875 -> round -> 20 (n = 2) or 25 (n = 3). Upstream sizes the train with
 * `withSize(Math.random() * 2 + 1)`, which yields 2 or 3 middles with equal probability.
 */
export const TRAIN_WIDTH_BY_MIDDLES = { 2: 20, 3: 25 } as const;

/** Playable columns on grass, used for the lily-pad winnability rule (CrossyGameMap). */
export const PLAYABLE_X_MIN = -4;
export const PLAYABLE_X_MAX = 4;

/** Default number of ticks `Game.step` advances after applying an action (one full hop). */
export const DECISION_TICKS = HOP_TICKS;

/**
 * Lethal / rideable half-width for the hero's centre point.
 * Same expression and operand order as upstream (`heroWidth / 2 + width / 2 - 0.1`).
 */
export function halfExtentFor(width: number): number {
  return HERO_WIDTH / 2 + width / 2 - 0.1;
}
