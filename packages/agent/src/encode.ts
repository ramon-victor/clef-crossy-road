import type { Observation, ObsMover, ObsRow } from "@ccr/core";
import { renderSceneImage } from "./image.ts";

export const ENCODER_IDS = ["json", "grid", "image", "json-rel"] as const;
export type EncoderId = (typeof ENCODER_IDS)[number];

/**
 * Encoders turn an `Observation` into the `state` sent to the model. They are pure functions of
 * the observation and add no information; changing the encoder is an ablation, not a new rule.
 *
 * - `json` (E0): the observation as is (rows are an array, because the service sorts object keys).
 * - `grid` (E1): a spatial text picture of the same facts, plus the exact numbers per row.
 * - `image` (E2): a top-down PNG of the same facts (see image.ts).
 * - `json-rel` (E3): the same JSON with every column measured from the chicken's own column.
 */
export function encodeState(encoder: EncoderId, obs: Observation): unknown {
  return encodeRequest(encoder, obs).state;
}

/** What goes into the request for this encoder: the `state`, plus images for `image`. */
export function encodeRequest(
  encoder: EncoderId,
  obs: Observation,
): { state: unknown; images?: string[] } {
  switch (encoder) {
    case "json":
      return { state: obs };
    case "json-rel":
      return { state: relativeState(obs) };
    case "grid":
      return { state: renderGrid(obs) };
    case "image":
      return {
        state: "The current view of the world is the attached picture.",
        images: [renderSceneImage(obs).dataUrl],
      };
  }
}

/** `column - origin`, to the observation's two decimals and never -0. */
const offset = (column: number, origin: number): number => {
  const rounded = Math.round((column - origin) * 100) / 100;
  return rounded === 0 ? 0 : rounded;
};

/**
 * The observation with entity columns as `dcol` (and `blocked_dcols` for trees): the offset from the
 * chicken's column. A change of origin only; it adds nothing derived from the actions (ADR-0005).
 * `player.col` stays absolute because the world edge is defined on it.
 */
function relativeState(obs: Observation): unknown {
  const origin = obs.player.col;
  return { player: obs.player, rows: obs.rows.map((row) => relativeRow(row, origin)) };
}

function relativeRow(row: ObsRow, origin: number): unknown {
  const shift = <T extends ObsMover>({ col, ...rest }: T) => ({
    dcol: offset(col, origin),
    ...rest,
  });
  switch (row.kind) {
    case "grass": {
      const { blocked_cols, ...rest } = row;
      return { ...rest, blocked_dcols: blocked_cols.map((c) => offset(c, origin)) };
    }
    case "road":
      return { ...row, vehicles: row.vehicles.map(shift) };
    case "water":
      return { ...row, platforms: row.platforms.map(shift) };
    case "rail":
      return { ...row, train: shift(row.train) };
  }
}

const GRID_MIN_COL = -6;
const GRID_MAX_COL = 6;

const cols = (): number[] => {
  const out: number[] = [];
  for (let c = GRID_MIN_COL; c <= GRID_MAX_COL; c++) out.push(c);
  return out;
};

const covers = (center: number, halfExtent: number, col: number): boolean =>
  Math.abs(col - center) < halfExtent;

function rowCells(row: ObsRow): { cells: string[]; notes: string } {
  const columns = cols();
  switch (row.kind) {
    case "grass":
      return {
        cells: columns.map((c) => (row.blocked_cols.includes(c) ? "T" : ".")),
        notes: "",
      };
    case "road":
      return {
        cells: columns.map((c) => {
          const hit = row.vehicles.find((v) => covers(v.col, v.half_extent, c));
          if (!hit) return ".";
          return hit.speed_cols_per_s > 0 ? ">" : hit.speed_cols_per_s < 0 ? "<" : "X";
        }),
        notes: row.vehicles
          .map((v) => `vehicle col=${v.col} half=${v.half_extent} speed=${v.speed_cols_per_s}/s`)
          .join("; "),
      };
    case "water":
      return {
        cells: columns.map((c) => {
          const hit = row.platforms.find((p) => covers(p.col, p.half_extent, c));
          if (!hit) return "~";
          return hit.type === "log" ? "L" : "o";
        }),
        notes: row.platforms
          .map((p) => `${p.type} col=${p.col} half=${p.half_extent} speed=${p.speed_cols_per_s}/s`)
          .join("; "),
      };
    case "rail":
      return {
        cells: columns.map((c) => (covers(row.train.col, row.train.half_extent, c) ? "X" : "=")),
        notes: `train col=${row.train.col} half=${row.train.half_extent} speed=${row.train.speed_cols_per_s}/s; warning_light=${row.warning_light}`,
      };
  }
}

function renderGrid(obs: Observation): string {
  const columns = cols();
  const header = `cols: ${columns.map((c) => String(c).padStart(2)).join(" ")}`;
  const lines = [...obs.rows]
    .sort((a, b) => b.dz - a.dz) // far rows first, like looking up the screen
    .map((row) => {
      const { cells, notes } = rowCells(row);
      if (row.dz === 0) {
        const index = Math.round(obs.player.col) - GRID_MIN_COL;
        if (index >= 0 && index < cells.length) cells[index] = "@";
      }
      const label = `dz=${row.dz > 0 ? "+" : ""}${row.dz}`.padEnd(6);
      const grid = cells.map((c) => c.padStart(2)).join(" ");
      return `${label}${row.kind.padEnd(6)}  ${grid}${notes ? `  | ${notes}` : ""}`;
    });
  const player = `player: col=${obs.player.col} standing_on=${obs.player.standing_on} riding=${obs.player.riding}`;
  return [
    "legend: @ chicken, T tree, > vehicle moving to larger col, < vehicle moving to smaller col, ~ water, L log, o lily pad, = rail, X train, . empty",
    header,
    ...lines,
    player,
  ].join("\n");
}
