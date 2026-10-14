import { MAX_ABS_X, type Observation, type ObsMover, type ObsRow } from "@ccr/core";
import { HOP_SECONDS, worldAfter } from "./forecast.ts";
import { emptyMemory, type Memory, type RememberedMove } from "./memory.ts";

/** Columns drawn on each side of the chicken, which is the width of the world. */
const SPAN = MAX_ABS_X;

const OUTCOME_TEXT: Readonly<Record<RememberedMove["outcome"], string>> = {
  hop: "moved",
  blocked: "blocked by a tree, did not move",
  stay: "waited",
  queued: "queued behind the hop in the air",
  ignored: "ignored",
};

/** What a move did, in the words a player would use. Shared by the text map and the JSON view. */
export const outcomeText = (outcome: RememberedMove["outcome"]): string => OUTCOME_TEXT[outcome];

const covers = (mover: ObsMover, column: number): boolean =>
  Math.abs(column - mover.col) < mover.half_extent;

const arrowOf = (speed: number): string => (speed > 0 ? ">" : speed < 0 ? "<" : "X");

function cell(row: ObsRow, column: number): string {
  if (Math.abs(column) > MAX_ABS_X) return "#";
  switch (row.kind) {
    case "grass":
      return row.blocked_cols.includes(column) ? "T" : ".";
    case "road": {
      const vehicle = row.vehicles.find((v) => covers(v, column));
      return vehicle ? arrowOf(vehicle.speed_cols_per_s) : ".";
    }
    case "water": {
      const platform = row.platforms.find((p) => covers(p, column));
      if (!platform) return "~";
      return platform.type === "log" ? "L" : "o";
    }
    case "rail":
      return covers(row.train, column) ? "X" : "=";
  }
}

const signed = (value: number): string => (value > 0 ? `+${value}` : String(value));

const motionText = (speed: number): string =>
  speed === 0 ? "still" : `moving ${speed > 0 ? "right" : "left"} ${Math.abs(speed)}/s`;

/** The exact numbers behind the drawn objects, relative to the chicken's own column. */
function notes(row: ObsRow, origin: number): string {
  const describe = (name: string, mover: ObsMover): string | null => {
    const offset = Math.round((mover.col - origin) * 100) / 100;
    if (Math.abs(offset) - mover.half_extent > SPAN + 1) return null; // outside the picture
    return `${name} dcol=${signed(offset)} half=${mover.half_extent} ${motionText(mover.speed_cols_per_s)}`;
  };
  switch (row.kind) {
    case "grass":
      return "";
    case "road":
      return row.vehicles
        .map((v) => describe("vehicle", v))
        .filter(Boolean)
        .join("; ");
    case "water":
      return row.platforms
        .map((p) => describe(p.type === "log" ? "log" : "lily pad", p))
        .filter(Boolean)
        .join("; ");
    case "rail":
      return `${describe("train", row.train) ?? "train far away"}; warning light ${row.warning_light}`;
  }
}

const label = (row: ObsRow): string =>
  `dz=${row.dz > 0 ? "+" : row.dz === 0 ? " " : ""}${row.dz} ${row.kind}`.padEnd(11);

function drawRow(
  row: ObsRow,
  centre: number,
  chicken: boolean,
  withNotes: boolean,
  origin: number,
) {
  const cells: string[] = [];
  for (let offset = -SPAN; offset <= SPAN; offset++) {
    cells.push(chicken && row.dz === 0 && offset === 0 ? "@" : cell(row, centre + offset));
  }
  const extra = withNotes ? notes(row, origin) : "";
  return `${label(row)} ${cells.join(" ")}${extra ? `   ${extra}` : ""}`;
}

/** Far rows first, like looking up the screen. */
const farFirst = (rows: readonly ObsRow[]): ObsRow[] => [...rows].sort((a, b) => b.dz - a.dz);

function drawMap(
  obs: Observation,
  options: { chicken: boolean; notes: boolean; moversOnly: boolean },
) {
  const centre = Math.round(obs.player.col);
  const rows = farFirst(obs.rows).filter((r) => !options.moversOnly || r.kind !== "grass");
  return rows.map((r) => drawRow(r, centre, options.chicken, options.notes, obs.player.col));
}

export function memoryLines(memory: Memory): string[] {
  if (memory.recent.length === 0) return ["YOUR LAST MOVES: none yet, this is your first move."];
  return [
    "YOUR LAST MOVES (oldest first):",
    ...memory.recent.map((m, i) => `${i + 1}. ${m.action}: ${outcomeText(m.outcome)}`),
    `Rows crossed so far: ${memory.score}. Moves since you last reached a new row: ${memory.sinceProgress}.`,
  ];
}

const columns = (): string =>
  Array.from({ length: 2 * SPAN + 1 }, (_, i) => signed(i - SPAN)).join(" ");

function situation(obs: Observation): string {
  const { col, standing_on, riding } = obs.player;
  return `You are in column ${col} on a ${standing_on} row${riding ? ", riding a platform" : ""}.`;
}

export interface ViewOptions {
  /** Also draw the moving objects as they will be when a hop that starts now lands. */
  forecast: boolean;
}

/**
 * The world as a person sees it: the whole screen as a map around the chicken, what is moving and
 * how fast, optionally where it will be when the next hop lands, and what the player remembers.
 * Everything here is perception or memory (ADR-0009); nothing says what a move would lead to.
 */
export function renderView(
  obs: Observation,
  memory: Memory = emptyMemory(),
  { forecast }: ViewOptions,
): string {
  const lines = [situation(obs), "", `MAP NOW (columns ${columns()} around you)`];
  lines.push(...drawMap(obs, { chicken: true, notes: true, moversOnly: false }));
  if (forecast) {
    lines.push("", `MAP IN ${HOP_SECONDS} s (moving objects only)`);
    lines.push(
      ...drawMap(worldAfter(obs, HOP_SECONDS), { chicken: false, notes: false, moversOnly: true }),
    );
  }
  lines.push("", ...memoryLines(memory));
  return lines.join("\n");
}
