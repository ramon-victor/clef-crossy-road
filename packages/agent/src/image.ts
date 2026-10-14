import type { Observation, ObsMover, ObsRow } from "@ccr/core";
import { encodePng, type Rgb, toBase64 } from "./png.ts";

/**
 * E2: a top-down picture of an `Observation`, for models that accept images (Clef-flash does).
 *
 * It draws only what the observation contains: terrain, trees, every object's hit zone, the warning
 * light and the chicken. Each object's velocity is drawn as a faint streak behind it, as long as the
 * distance it covers in half a second, because a still picture cannot show speed. No safety judgement
 * is added (ADR-0005): it is a change of representation, reported as its own condition.
 *
 * With 32 px per cell the picture is 13 x 12 patches for the model's 32 px tokenizer: about
 * 13 * 12 + 3 = 159 image tokens.
 */

export const IMAGE_COLS = 13; // col -6 .. +6
export const IMAGE_MIN_COL = -6;
const CELL = 32;
const STREAK_SECONDS = 0.5;

const PALETTE: readonly Rgb[] = [
  [0, 0, 0], // 0 outside the known world
  [110, 190, 90], // 1 grass
  [47, 109, 42], // 2 tree canopy
  [107, 74, 43], // 3 tree trunk
  [61, 64, 72], // 4 road
  [207, 207, 207], // 5 road marking
  [91, 187, 224], // 6 water
  [122, 74, 42], // 7 log
  [46, 158, 75], // 8 lily pad
  [107, 91, 83], // 9 rail bed
  [59, 47, 42], // 10 rail tie
  [216, 64, 64], // 11 vehicle
  [42, 45, 58], // 12 train
  [242, 217, 160], // 13 velocity streak
  [255, 214, 64], // 14 chicken
  [29, 29, 29], // 15 outline
  [255, 32, 32], // 16 light on
  [112, 32, 32], // 17 light off
  [255, 255, 255], // 18 white (direction chevrons)
];

const C = {
  none: 0,
  grass: 1,
  canopy: 2,
  trunk: 3,
  road: 4,
  marking: 5,
  water: 6,
  log: 7,
  pad: 8,
  bed: 9,
  tie: 10,
  vehicle: 11,
  train: 12,
  streak: 13,
  chicken: 14,
  outline: 15,
  lightOn: 16,
  lightOff: 17,
  white: 18,
} as const;

export interface SceneImage {
  width: number;
  height: number;
  /** The encoded PNG file. */
  png: Uint8Array;
  /** `data:image/png;base64,...` */
  dataUrl: string;
}

export const IMAGE_LEGEND = [
  "The picture is a top-down view of the world: one square is one column and one row.",
  "13 columns, col -6 on the left and col +6 on the right. Far rows are at the top; the chicken's own row is the fourth from the bottom.",
  "Green is grass with dark green trees (blocked columns), dark grey is road, blue is water, brown with dark ties is rail.",
  "Red blocks are vehicles and the dark long block is the train, drawn over their whole hit zone; brown blocks on water are logs and green discs are lily pads, also drawn over their hit zone.",
  "A pale streak behind an object shows how far it moves in half a second; white chevrons show its direction. A red dot at the left of a rail row is the warning light (bright = on).",
  "The yellow square with a dark outline is the chicken.",
].join(" ");

class Canvas {
  readonly pixels: Uint8Array;
  readonly width: number;
  readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height);
  }

  rect(x0: number, y0: number, x1: number, y1: number, color: number): void {
    const xa = Math.max(0, Math.round(Math.min(x0, x1)));
    const xb = Math.min(this.width, Math.round(Math.max(x0, x1)));
    const ya = Math.max(0, Math.round(Math.min(y0, y1)));
    const yb = Math.min(this.height, Math.round(Math.max(y0, y1)));
    for (let y = ya; y < yb; y++) this.pixels.fill(color, y * this.width + xa, y * this.width + xb);
  }

  disc(cx: number, cy: number, r: number, color: number): void {
    const ya = Math.max(0, Math.floor(cy - r));
    const yb = Math.min(this.height - 1, Math.ceil(cy + r));
    for (let y = ya; y <= yb; y++) {
      for (
        let x = Math.max(0, Math.floor(cx - r));
        x <= Math.min(this.width - 1, Math.ceil(cx + r));
        x++
      ) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) this.pixels[y * this.width + x] = color;
      }
    }
  }

  /** Filled triangle pointing right (dir = 1) or left (dir = -1). */
  chevron(cx: number, cy: number, size: number, dir: 1 | -1, color: number): void {
    for (let i = 0; i < size; i++) {
      const half = Math.round((size - i) * 0.6);
      this.rect(cx + dir * i - 1, cy - half, cx + dir * i, cy + half + 1, color);
    }
  }
}

const px = (col: number): number => (col - IMAGE_MIN_COL + 0.5) * CELL;

function drawMover(
  canvas: Canvas,
  m: ObsMover,
  top: number,
  bottom: number,
  body: number,
  options: { chevron: boolean },
): void {
  const left = px(m.col - m.half_extent);
  const right = px(m.col + m.half_extent);
  const mid = (top + bottom) / 2;
  const streak = Math.abs(m.speed_cols_per_s) * STREAK_SECONDS * CELL;
  if (streak > 0.5) {
    const ya = mid - 4;
    const yb = mid + 4;
    // The streak trails behind the direction of travel.
    if (m.speed_cols_per_s > 0) canvas.rect(left - streak, ya, left, yb, C.streak);
    else canvas.rect(right, ya, right + streak, yb, C.streak);
  }
  canvas.rect(left, top, right, bottom, body);
  if (options.chevron && m.speed_cols_per_s !== 0 && right - left > 14) {
    const dir = m.speed_cols_per_s > 0 ? 1 : -1;
    canvas.chevron((left + right) / 2 - dir * 5, mid, 9, dir, C.white);
  }
}

function drawRow(canvas: Canvas, row: ObsRow, top: number): void {
  const bottom = top + CELL;
  const mid = top + CELL / 2;
  switch (row.kind) {
    case "grass": {
      canvas.rect(0, top, canvas.width, bottom, C.grass);
      for (const col of row.blocked_cols) {
        const x = px(col);
        canvas.rect(x - 4, mid + 2, x + 4, bottom - 2, C.trunk);
        canvas.rect(x - 12, top + 3, x + 12, mid + 4, C.canopy);
      }
      break;
    }
    case "road": {
      canvas.rect(0, top, canvas.width, bottom, C.road);
      for (let x = 0; x < canvas.width; x += 40)
        canvas.rect(x, mid - 1, x + 20, mid + 1, C.marking);
      for (const v of row.vehicles)
        drawMover(canvas, v, top + 5, bottom - 5, C.vehicle, { chevron: true });
      break;
    }
    case "water": {
      canvas.rect(0, top, canvas.width, bottom, C.water);
      for (const p of row.platforms) {
        if (p.type === "log") drawMover(canvas, p, top + 6, bottom - 6, C.log, { chevron: true });
        else {
          const half = Math.min(p.half_extent, 1) * CELL * 0.62;
          canvas.disc(px(p.col), mid, half, C.pad);
        }
      }
      break;
    }
    case "rail": {
      canvas.rect(0, top, canvas.width, bottom, C.bed);
      for (let x = 4; x < canvas.width; x += 14) canvas.rect(x, top + 4, x + 5, bottom - 4, C.tie);
      drawMover(canvas, row.train, top + 3, bottom - 3, C.train, { chevron: true });
      canvas.disc(12, mid, 7, row.warning_light === "on" ? C.lightOn : C.lightOff);
      break;
    }
  }
}

export interface SceneImageWindow {
  /** Rows shown behind the chicken (default 3). */
  behind?: number;
  /** Rows shown ahead of it (default 8). */
  ahead?: number;
}

export function renderSceneImage(obs: Observation, view: SceneImageWindow = {}): SceneImage {
  const behind = view.behind ?? 3;
  const ahead = view.ahead ?? 8;
  const rowsShown = behind + ahead + 1;
  const canvas = new Canvas(IMAGE_COLS * CELL, rowsShown * CELL);

  for (const row of obs.rows) {
    if (row.dz < -behind || row.dz > ahead) continue;
    drawRow(canvas, row, (ahead - row.dz) * CELL);
  }

  // The chicken sits on its own row (dz = 0), at its (possibly fractional) column.
  const cx = px(obs.player.col);
  const cy = ahead * CELL + CELL / 2;
  canvas.rect(cx - 13, cy - 13, cx + 13, cy + 13, C.outline);
  canvas.rect(cx - 10, cy - 10, cx + 10, cy + 10, C.chicken);

  const png = encodePng(canvas.width, canvas.height, canvas.pixels, PALETTE);
  return {
    width: canvas.width,
    height: canvas.height,
    png,
    dataUrl: `data:image/png;base64,${toBase64(png)}`,
  };
}

/** Palette index of a named colour, for tests. */
export const PALETTE_INDEX = C;
