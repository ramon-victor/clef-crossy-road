import {
  DECISION_TICKS,
  type Observation,
  type ObsMover,
  type ObsRow,
  TICKS_PER_SECOND,
} from "@ccr/core";

/** How long one hop takes, which is how far ahead the "in 0.2 s" view looks. */
export const HOP_SECONDS = DECISION_TICKS / TICKS_PER_SECOND;

const round2 = (value: number): number => {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
};

/** Where `mover` will be after `seconds`, if it keeps its speed (what the eye sees as motion). */
export const columnAfter = (mover: ObsMover, seconds: number): number =>
  round2(mover.col + mover.speed_cols_per_s * seconds);

function rowAfter(row: ObsRow, seconds: number): ObsRow {
  const moved = <T extends ObsMover>(mover: T): T => ({
    ...mover,
    col: columnAfter(mover, seconds),
  });
  switch (row.kind) {
    case "grass":
      return row;
    case "road":
      return { ...row, vehicles: row.vehicles.map(moved) };
    case "water":
      return { ...row, platforms: row.platforms.map(moved) };
    case "rail":
      return { ...row, train: moved(row.train) };
  }
}

/**
 * The same world `seconds` later: every moving object advanced at its own speed. It depends on
 * nothing but the world, so it is the same for every candidate move and for wherever the chicken
 * stands, which is why showing it is perception and not judgement (ADR-0009). The chicken itself
 * and the traffic light are left as they are.
 */
export function worldAfter(obs: Observation, seconds: number): Observation {
  return { player: obs.player, rows: obs.rows.map((row) => rowAfter(row, seconds)) };
}
