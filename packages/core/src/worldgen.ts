import {
  CAR_WIDTHS,
  FORCED_GRASS_ROWS,
  LILY_PAD_WIDTH,
  LOG_WIDTHS,
  PLAYABLE_X_MAX,
  PLAYABLE_X_MIN,
  SOLID_ROWS,
  TRAIN_SPEED,
  TRAIN_WIDTH_BY_MIDDLES,
  TRAIN_WRAP_OFFSET,
  WRAP_OFFSET,
} from "./constants.ts";
import { createMover, type Mover } from "./mover.ts";
import { createRng, type Rng } from "./rng.ts";

export interface GrassRow {
  readonly kind: "grass";
  readonly z: number;
  /** Integer columns occupied by trees/boulders (upstream `obstacleMap` keys), sorted ascending. */
  readonly blocked: readonly number[];
  /** Rows 1-4: every column is a tree (the hero can never go back past row 5). */
  readonly solid: boolean;
}

export interface RoadRow {
  readonly kind: "road";
  readonly z: number;
  readonly cars: readonly Mover[];
}

export interface WaterRow {
  readonly kind: "water";
  readonly z: number;
  /** Even rows hold static lily pads, odd rows hold drifting logs (Water.isStaticRow). */
  readonly flavor: "lily_pads" | "logs";
  readonly items: readonly Mover[];
  /** Integer columns of the pads, used to keep the next grass row passable. */
  readonly lilyPadCols: readonly number[];
}

export interface RailRow {
  readonly kind: "rail";
  readonly z: number;
  readonly train: Mover;
}

export type RowSpec = GrassRow | RoadRow | WaterRow | RailRow;
export type RowKind = RowSpec["kind"];

/** Produces row `z` given row `z - 1` (undefined for the first rows). Must be pure. */
export type RowGenerator = (z: number, prev: RowSpec | undefined) => RowSpec;

export function createRowGenerator(seed: number): RowGenerator {
  return (z, prev) => generateRow(seed, z, prev);
}

/** CrossyGameMap.newRow + Row/*.generate. Randomness is drawn from the row's own stream. */
export function generateRow(seed: number, z: number, prev: RowSpec | undefined): RowSpec {
  const rng = createRng(seed, z);

  let kind: "grass" | "road" | "water" | "rail" = "grass";
  if (z >= FORCED_GRASS_ROWS) {
    const roll = rng.int(3); // ROW_TYPES = ["grass", "roadtype", "water"]
    if (roll === 1) kind = rng.int(4) === 0 ? "rail" : "road";
    else if (roll === 2) kind = "water";
  }

  switch (kind) {
    case "grass": {
      const required = prev?.kind === "water" ? prev.lilyPadCols : [];
      return generateGrass(z, rng, z < SOLID_ROWS, required);
    }
    case "road":
      return generateRoad(z, rng);
    case "water": {
      const clear = prev?.kind === "grass" ? clearColumnsOf(prev) : [];
      return generateWater(z, rng, clear);
    }
    case "rail":
      return generateRail(z, rng);
  }
}

/** CrossyGameMap.getClearPositionsFromGrass: columns -4..4 without an obstacle. */
function clearColumnsOf(row: GrassRow): number[] {
  const blocked = new Set(row.blocked);
  const clear: number[] = [];
  for (let x = PLAYABLE_X_MIN; x <= PLAYABLE_X_MAX; x++) {
    if (!blocked.has(x)) clear.push(x);
  }
  return clear;
}

/**
 * Row/Grass.treeGen. Note: upstream defines `Fill.empty` but never branches on it, so every
 * non-solid row (including rows 5-9) gets walls at |x| >= 5 plus 1-3 random interior trees.
 */
function generateGrass(
  z: number,
  rng: Rng,
  solid: boolean,
  requiredClear: readonly number[],
): GrassRow {
  const required = new Set(requiredClear);
  const blocked: number[] = [];
  const add = (x: number) => {
    if (required.has(Math.trunc(x))) return; // Grass.addObstacle
    blocked.push(x);
  };

  const count = Math.round(rng.next() * 2) + 1;
  let placed = 0;
  for (let x = -3; x < 12; x++) {
    const px = x - 4;
    if (solid) {
      add(px);
      continue;
    }
    if (x >= 9 || x <= -1) {
      add(px); // walls
      continue;
    }
    if (placed < count && px !== 0 && rng.next() > 0.6) {
      add(px);
      placed++; // counted even when addObstacle skipped it, as upstream
    }
  }
  blocked.sort((a, b) => a - b);
  return { kind: "grass", z, blocked, solid };
}

/** Row/Road.carGen. */
function generateRoad(z: number, rng: Rng): RoadRow {
  const speed = rng.next() * 0.06 + 0.02; // 0.02 .. 0.08 tiles per tick
  const numCars = Math.floor(rng.next() * 2) + 1; // 1 or 2 (upstream comment says 3, code never does)
  const xDir = rng.next() > 0.5 ? -1 : 1;
  let xPos = -6 * xDir;
  const cars: Mover[] = [];
  for (let i = 0; i < numCars; i++) {
    const variant = rng.int(CAR_WIDTHS.length);
    cars.push(
      createMover({
        kind: "car",
        variant,
        width: CAR_WIDTHS[variant] as number,
        speed: speed * xDir,
        x0: xPos,
        wrapOffset: WRAP_OFFSET,
      }),
    );
    xPos -= (rng.next() * 3 + 5) * xDir;
  }
  return { kind: "road", z, cars };
}

/** Row/Water.generate -> generateStatic (even rows) or generateDynamic (odd rows). */
function generateWater(z: number, rng: Rng, clearPositions: readonly number[]): WaterRow {
  if (z % 2 === 0) return generateLilyPads(z, rng, clearPositions);
  return generateLogs(z, rng);
}

function generateLilyPads(z: number, rng: Rng, clearPositions: readonly number[]): WaterRow {
  const numItems = Math.floor(rng.next() * 2) + 2; // 2 or 3
  const positions: number[] = [];
  let xPos = Math.floor(rng.next() * 2 - 4); // -4 or -3
  for (let i = 0; i < numItems; i++) {
    positions.push(xPos);
    xPos += Math.floor(rng.next() * 2 + 2); // spacing 2 or 3
  }

  // Keep at least one pad on a column the previous grass row leaves free, so the map is winnable.
  if (clearPositions.length > 0) {
    const accessible = positions.some((p) => clearPositions.includes(Math.trunc(p)));
    if (!accessible) {
      positions[0] = clearPositions[Math.floor(rng.next() * clearPositions.length)] as number;
      positions.sort((a, b) => a - b);
    }
  }

  const items = positions.map((x0) =>
    createMover({
      kind: "lily_pad",
      variant: 0,
      width: LILY_PAD_WIDTH,
      speed: 0,
      x0,
      wrapOffset: WRAP_OFFSET,
    }),
  );
  return {
    kind: "water",
    z,
    flavor: "lily_pads",
    items,
    lilyPadCols: positions.map((p) => Math.trunc(p)),
  };
}

function generateLogs(z: number, rng: Rng): WaterRow {
  const speed = rng.next() * 0.05 + 0.02; // 0.02 .. 0.07 tiles per tick
  const numItems = Math.floor(rng.next() * 2) + 2; // 2 or 3
  const xDir = rng.next() > 0.5 ? -1 : 1;
  let xPos = -6 * xDir;
  const items: Mover[] = [];
  for (let i = 0; i < numItems; i++) {
    const variant = rng.int(LOG_WIDTHS.length);
    items.push(
      createMover({
        kind: "log",
        variant,
        width: LOG_WIDTHS[variant] as number,
        speed: speed * xDir,
        x0: xPos,
        wrapOffset: WRAP_OFFSET,
      }),
    );
    xPos -= (rng.next() * 3 + 5) * xDir;
  }
  return { kind: "water", z, flavor: "logs", items, lilyPadCols: [] };
}

/**
 * Row/RailRoad. Upstream starts every train at whatever x its pooled row object last had (0 on
 * first use), so the phase depended on pool history. Here the phase is drawn from the row stream.
 */
function generateRail(z: number, rng: Rng): RailRow {
  const size = rng.next() * 2 + 1; // Train.withSize(Math.random() * 2 + 1)
  let middles = 0;
  for (let i = 0; i < size; i++) middles++;
  const m = (middles === 3 ? 3 : 2) as 2 | 3;
  const x0 = rng.next() * (2 * TRAIN_WRAP_OFFSET) - TRAIN_WRAP_OFFSET;
  return {
    kind: "rail",
    z,
    train: createMover({
      kind: "train",
      variant: m,
      width: TRAIN_WIDTH_BY_MIDDLES[m],
      speed: TRAIN_SPEED,
      x0,
      wrapOffset: TRAIN_WRAP_OFFSET,
    }),
  };
}
