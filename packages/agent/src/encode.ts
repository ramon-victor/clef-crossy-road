import type { Observation, ObsMover, ObsRow } from "@ccr/core";
import { columnAfter, HOP_SECONDS } from "./forecast.ts";
import { renderSceneImage } from "./image.ts";
import { ACTION_NAMES, lanesState, movesState } from "./lanes.ts";
import { emptyMemory, type Memory } from "./memory.ts";
import { sceneState } from "./scene.ts";
import { outcomeText, renderView } from "./view.ts";

export const ENCODER_IDS = [
  "json",
  "grid",
  "image",
  "json-rel",
  "view",
  "view-fx",
  "json-fx",
  "lanes",
  "moves",
  "scene",
] as const;
export type EncoderId = (typeof ENCODER_IDS)[number];

/**
 * What a condition lets the model know, from least to most (ADR-0009). Every report shows it next to
 * the policy, so a result is never read without it.
 * - now:      the facts at the instant of the decision, in whatever format.
 * - memory:   plus what the player remembers of its last moves.
 * - forecast: plus where the moving objects will be when the next hop lands.
 * - words:    the same knowledge as `forecast`, but compared by the code and told as the word for what
 *            fills each cell (`lanes`, ADR-0010). Nothing is added about the world; the model no longer
 *            has to subtract and compare.
 */
export type PerceptionLevel = "now" | "memory" | "forecast" | "words";

export const ENCODER_LEVEL: Readonly<Record<EncoderId, PerceptionLevel>> = {
  json: "now",
  grid: "now",
  image: "now",
  "json-rel": "now",
  view: "memory",
  "view-fx": "forecast",
  "json-fx": "forecast",
  lanes: "words",
  moves: "words",
  scene: "words",
};

/**
 * Encoders turn an `Observation` into the `state` sent to the model. They are pure functions of
 * the observation (and, for the memory levels, of what the player remembers); changing the encoder
 * is an ablation, not a new rule. The first four ignore the memory, so their requests never change.
 *
 * - `json` (E0): the observation as is (rows are an array, because the service sorts object keys).
 * - `grid` (E1): a spatial text picture of the same facts, plus the exact numbers per row.
 * - `image` (E2): a top-down PNG of the same facts (see image.ts).
 * - `json-rel` (E3): the same JSON with every column measured from the chicken's own column.
 * - `view` (E4): the whole screen as a text map around the chicken, plus the memory (view.ts).
 * - `view-fx` (E5): `view` plus a second map of the moving objects as they will be in 0.2 s.
 * - `json-fx` (E6): `json-rel` plus each object's column in 0.2 s and the memory as fields.
 * - `lanes` (E7): what fills the cells the chicken could land on, in a closed vocabulary of words (lanes.ts).
 * - `moves` (E8): the same words grouped under the name of each move, so the keys are the words of the options.
 */
export function encodeState(encoder: EncoderId, obs: Observation, memory?: Memory): unknown {
  return encodeRequest(encoder, obs, memory).state;
}

/** What goes into the request for this encoder: the `state`, plus images for `image`. */
export function encodeRequest(
  encoder: EncoderId,
  obs: Observation,
  memory?: Memory,
): { state: unknown; images?: string[] } {
  switch (encoder) {
    case "json":
      return { state: obs };
    case "json-rel":
      return { state: relativeState(obs) };
    case "json-fx":
      return {
        state: relativeState(obs, { horizon: HOP_SECONDS, memory: memory ?? emptyMemory() }),
      };
    case "lanes":
      return { state: lanesState(obs, memory) };
    case "scene":
      return { state: sceneState(obs, memory ?? emptyMemory()) };
    case "moves":
      return { state: movesState(lanesState(obs, memory), ACTION_NAMES) };
    case "view":
      return { state: renderView(obs, memory, { forecast: false }) };
    case "view-fx":
      return { state: renderView(obs, memory, { forecast: true }) };
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
function relativeState(
  obs: Observation,
  { horizon, memory }: { horizon?: number; memory?: Memory } = {},
): unknown {
  const origin = obs.player.col;
  const rows = obs.rows.map((row) => relativeRow(row, origin, horizon));
  return memory
    ? { player: obs.player, memory: memoryState(memory), rows }
    : { player: obs.player, rows };
}

/** The memory as JSON fields, in the same words as the text view. */
function memoryState(memory: Memory) {
  return {
    last_moves: memory.recent.map((m) => ({ action: m.action, result: outcomeText(m.outcome) })),
    rows_crossed: memory.score,
    moves_since_new_row: memory.sinceProgress,
  };
}

function relativeRow(row: ObsRow, origin: number, horizon?: number): unknown {
  const shift = <T extends ObsMover>(mover: T) => {
    const { col, ...rest } = mover;
    return {
      dcol: offset(col, origin),
      ...(horizon === undefined ? {} : { dcol_after: offset(columnAfter(mover, horizon), origin) }),
      ...rest,
    };
  };
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
