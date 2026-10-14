import { LILY_PAD_WIDTH, LOG_WIDTHS, TRAIN_WIDTH_BY_MIDDLES, WRAP_OFFSET } from "./constants.ts";
import { createMover, type Mover } from "./mover.ts";
import type { RowGenerator, RowSpec } from "./worldgen.ts";

/** Hand-built rows for tests. Rows not listed are open grass. */
export function openGrass(z: number): RowSpec {
  return { kind: "grass", z, blocked: [], solid: false };
}

export function rowsGenerator(rows: Readonly<Record<number, RowSpec>>): RowGenerator {
  return (z) => rows[z] ?? openGrass(z);
}

export function carAt(x0: number, speed = 0, width = 2): Mover {
  return createMover({
    kind: "car",
    variant: 0,
    width,
    speed,
    x0,
    wrapOffset: WRAP_OFFSET,
  });
}

export function logAt(x0: number, speed = 0, variant = 2): Mover {
  return createMover({
    kind: "log",
    variant,
    width: LOG_WIDTHS[variant] as number,
    speed,
    x0,
    wrapOffset: WRAP_OFFSET,
  });
}

export function padAt(x0: number): Mover {
  return createMover({
    kind: "lily_pad",
    variant: 0,
    width: LILY_PAD_WIDTH,
    speed: 0,
    x0,
    wrapOffset: WRAP_OFFSET,
  });
}

export function trainAt(x0: number, speed = 0.8, wrapOffset = 110, middles: 2 | 3 = 2): Mover {
  return createMover({
    kind: "train",
    variant: middles,
    width: TRAIN_WIDTH_BY_MIDDLES[middles],
    speed,
    x0,
    wrapOffset,
  });
}

export function roadRow(z: number, cars: Mover[]): RowSpec {
  return { kind: "road", z, cars };
}

export function waterRow(z: number, items: Mover[], flavor: "lily_pads" | "logs"): RowSpec {
  return {
    kind: "water",
    z,
    flavor,
    items,
    lilyPadCols: flavor === "lily_pads" ? items.map((i) => Math.trunc(i.x0)) : [],
  };
}

export function railRow(z: number, train: Mover): RowSpec {
  return { kind: "rail", z, train };
}
