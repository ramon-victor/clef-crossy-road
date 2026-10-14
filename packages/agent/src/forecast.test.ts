import { Game, type ObsRow, observe } from "@ccr/core";
import { describe, expect, it } from "vitest";
import { columnAfter, HOP_SECONDS, worldAfter } from "./forecast.ts";

type Mover = { col: number; speed_cols_per_s: number; half_extent: number };

const moversOf = (row: ObsRow): Mover[] => {
  switch (row.kind) {
    case "road":
      return row.vehicles;
    case "water":
      return row.platforms;
    case "rail":
      return [row.train];
    case "grass":
      return [];
  }
};

describe("worldAfter", () => {
  it("is exactly one hop long", () => {
    expect(HOP_SECONDS).toBeCloseTo(0.2, 10);
  });

  it("moves each object by speed x time and touches nothing else", () => {
    const mover = { col: 1.5, speed_cols_per_s: -2, half_extent: 1 };
    expect(columnAfter(mover, 0.2)).toBe(1.1);
    expect(columnAfter({ ...mover, speed_cols_per_s: 0 }, 0.2)).toBe(1.5);

    const obs = observe(new Game({ seed: 4 }));
    const later = worldAfter(obs, HOP_SECONDS);
    expect(later.player).toEqual(obs.player);
    expect(later.rows.map((r) => [r.dz, r.kind])).toEqual(obs.rows.map((r) => [r.dz, r.kind]));
    for (const [i, row] of obs.rows.entries()) {
      if (row.kind === "grass") expect(later.rows[i]).toEqual(row);
    }
  });

  it("matches the real world 12 ticks later, for everything in view", () => {
    let compared = 0;
    for (const seed of [1, 4, 9, 23, 60]) {
      for (const warmup of [0, 40, 400]) {
        const game = new Game({ seed });
        game.advance(warmup);
        const predicted = worldAfter(observe(game), HOP_SECONDS);
        const real = game.clone();
        real.advance(12);
        const actual = observe(real);
        for (const [i, row] of predicted.rows.entries()) {
          const truth = moversOf(actual.rows[i] as ObsRow);
          for (const [j, mover] of moversOf(row).entries()) {
            const inView = Math.abs(mover.col) < 9 && Math.abs((truth[j] as Mover).col) < 9;
            if (!inView) continue; // a wrap around the far end is not something the eye sees
            expect(mover.col).toBeCloseTo((truth[j] as Mover).col, 1);
            compared++;
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(100);
  });

  it("is a fact about the world: the same wherever the chicken stands and whatever it does", () => {
    const hopped = new Game({ seed: 12 });
    hopped.step("hop_forward");
    const sidestepped = new Game({ seed: 12 });
    sidestepped.step("hop_left");
    expect(hopped.tick).toBe(sidestepped.tick);
    expect(hopped.heroRow).not.toBe(sidestepped.heroRow);

    const forecastByRow = (game: Game) => {
      const obs = worldAfter(observe(game, { behind: 3, ahead: 8 }), HOP_SECONDS);
      return new Map(obs.rows.map((row) => [game.heroRow + row.dz, moversOf(row)]));
    };
    const a = forecastByRow(hopped);
    const b = forecastByRow(sidestepped);
    let shared = 0;
    for (const [row, movers] of a) {
      const other = b.get(row);
      if (!other) continue;
      expect(movers).toEqual(other);
      shared++;
    }
    expect(shared).toBeGreaterThan(8);
  });
});
