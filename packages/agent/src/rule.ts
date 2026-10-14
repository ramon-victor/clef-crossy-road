import { type Action, MAX_ABS_X, type Observation, type ObsRow } from "@ccr/core";
import { HOP_SECONDS, worldAfter } from "./forecast.ts";
import type { Memory } from "./memory.ts";
import type { Decision, ObservationPolicy, PolicyFactory } from "./policy.ts";

/** What stepping onto a cell leads to, judged from what is on the map. */
type Verdict = "open" | "blocked" | "deadly";

function verdictAt(row: ObsRow | undefined, col: number): Verdict {
  if (!row) return "open"; // past the edge of the view: nothing is known, so nothing is in the way
  if (Math.abs(col) > MAX_ABS_X) return "deadly";
  switch (row.kind) {
    case "grass":
      return row.blocked_cols.includes(Math.trunc(col)) ? "blocked" : "open";
    case "road":
      return row.vehicles.some((v) => Math.abs(col - v.col) < v.half_extent) ? "deadly" : "open";
    case "water":
      return row.platforms.some((p) => Math.abs(col - p.col) < p.half_extent) ? "open" : "deadly";
    case "rail": {
      const train = row.train;
      return row.warning_light === "on" || Math.abs(col - train.col) < train.half_extent
        ? "deadly"
        : "open";
    }
  }
}

const rowAt = (obs: Observation, dz: number): ObsRow | undefined =>
  obs.rows.find((row) => row.dz === dz);

/** The cell a hop ends on, as a row offset and a column. */
function landing(action: Action, col: number): { dz: number; col: number } {
  switch (action) {
    case "hop_forward":
      return { dz: 1, col: Math.round(col) };
    case "hop_back":
      return { dz: -1, col: Math.round(col) };
    case "hop_left":
      return { dz: 0, col: col - 1 };
    case "hop_right":
      return { dz: 0, col: col + 1 };
    case "stay":
      return { dz: 0, col };
  }
}

const COLUMNS = Array.from({ length: 2 * MAX_ABS_X + 1 }, (_, i) => i - MAX_ABS_X);

/**
 * A scripted player that reads exactly what the `view` encoders show (the map, the objects' numbers,
 * and with `forecast` the map one hop ahead) and plays the way a careful person would: hop forward when
 * the cell ahead is open, otherwise slide along the row towards the nearest open cell, otherwise wait.
 * It is a reference, not a model. It answers "is that view enough to play well?" before anything is
 * spent on the API (docs/07).
 */
function decideFrom(obs: Observation, forecast: boolean): Decision {
  const col = obs.player.col;
  const landingWorld = forecast ? worldAfter(obs, HOP_SECONDS) : obs;
  // Sliding takes a hop and the hop forward another, so the open cell ahead is judged a hop later still.
  const planningWorld = forecast ? worldAfter(obs, 2 * HOP_SECONDS) : obs;

  const verdict = (action: Action): Verdict => {
    const end = landing(action, col);
    if (action === "stay" && obs.player.riding) return "open"; // the platform carries it
    return verdictAt(rowAt(landingWorld, end.dz), end.col);
  };

  if (verdict("hop_forward") === "open") return { action: "hop_forward" };

  const ahead = rowAt(planningWorld, 1);
  const openAhead = COLUMNS.filter((c) => verdictAt(ahead, c) === "open").sort(
    (a, b) => Math.abs(a - col) - Math.abs(b - col),
  );
  for (const target of openAhead) {
    if (target === Math.round(col)) continue;
    const slide: Action = target > col ? "hop_right" : "hop_left";
    if (verdict(slide) === "open") return { action: slide };
  }
  if (verdict("stay") === "open") return { action: "stay" };
  for (const action of ["hop_back", "hop_left", "hop_right"] as const) {
    if (verdict(action) === "open") return { action };
  }
  return { action: "hop_forward" };
}

function rulePolicy(id: string, forecast: boolean): PolicyFactory {
  const policy: ObservationPolicy = {
    kind: "observation",
    id,
    // The memory is accepted and unused: this reader only needs the map.
    decide: async (obs: Observation, _memory?: Memory) => decideFrom(obs, forecast),
  };
  return { id, create: () => policy };
}

/** Reads the map as it is now. */
export const ruleView = rulePolicy("rule-view", false);
/** Reads the map as it is now and as it will be when the hop lands. */
export const ruleViewFx = rulePolicy("rule-view-fx", true);
