import { describe, expect, it } from "vitest";
import { Game } from "./game.ts";
import { OBSERVATION_KEYS, observe } from "./observe.ts";
import {
  carAt,
  logAt,
  padAt,
  railRow,
  roadRow,
  rowsGenerator,
  trainAt,
  waterRow,
} from "./testing.ts";
import type { RowSpec } from "./worldgen.ts";

const sorted = (o: object) => Object.keys(o).sort();
const keys = (list: readonly string[]) => [...list].sort();

/** Names that would mean we are classifying moves for the model. */
const FORBIDDEN =
  /safe|danger|collid|collision|legal|valid|blocked_move|ttc|time_to|will_|best|recommend/i;

describe("observation (fairness rule, ADR-0005)", () => {
  it("only ever uses the whitelisted keys, for every row kind", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const game = new Game({ seed });
      for (let i = 0; i < 40 && game.alive; i++) {
        game.step("hop_forward");
        const obs = observe(game, { behind: 3, ahead: 10 });
        expect(sorted(obs)).toEqual(keys(OBSERVATION_KEYS.observation));
        expect(sorted(obs.player)).toEqual(keys(OBSERVATION_KEYS.player));
        for (const row of obs.rows) {
          seen.add(row.kind);
          expect(sorted(row)).toEqual(keys(OBSERVATION_KEYS[row.kind]));
          if (row.kind === "road") {
            for (const v of row.vehicles) expect(sorted(v)).toEqual(keys(OBSERVATION_KEYS.mover));
          }
          if (row.kind === "water") {
            for (const p of row.platforms) {
              expect(sorted(p)).toEqual(keys(OBSERVATION_KEYS.platform));
            }
          }
          if (row.kind === "rail") expect(sorted(row.train)).toEqual(keys(OBSERVATION_KEYS.mover));
        }
      }
    }
    expect([...seen].sort()).toEqual(["grass", "rail", "road", "water"]);
  });

  it("contains no key that names a safety judgement or a move classification", () => {
    const all = JSON.stringify(OBSERVATION_KEYS);
    expect(all).not.toMatch(FORBIDDEN);
    const game = new Game({ seed: 11 });
    expect(JSON.stringify(observe(game))).not.toMatch(FORBIDDEN);
  });

  it("flips x into col so that +col is the screen's right", () => {
    const rows: Record<number, RowSpec> = {
      9: roadRow(9, [carAt(-3, 0.05)]), // upstream x = -3 is 3 columns to the right
    };
    const game = new Game({ seed: 1, generator: rowsGenerator(rows) });
    game.step("hop_left"); // upstream x = +1 -> col -1
    const obs = observe(game);
    expect(obs.player.col).toBe(-1);
    const road = obs.rows.find((r) => r.kind === "road");
    expect(road?.kind === "road" && road.vehicles[0]?.col).toBeCloseTo(3 - 0.05 * 12, 5);
    expect(road?.kind === "road" && road.vehicles[0]?.speed_cols_per_s).toBeCloseTo(-3, 5);
  });

  it("reports the train warning light and entity types", () => {
    const rows: Record<number, RowSpec> = {
      9: railRow(9, trainAt(0, 0.8, 110)),
      10: waterRow(10, [logAt(0, 0.04), padAt(3)], "logs"),
    };
    const game = new Game({ seed: 1, generator: rowsGenerator(rows) });
    expect(observe(game).rows.find((r) => r.kind === "rail")).toMatchObject({
      kind: "rail",
      warning_light: "off",
    });
    game.advance(138);
    expect(observe(game).rows.find((r) => r.kind === "rail")).toMatchObject({
      warning_light: "on",
    });
    const water = observe(game).rows.find((r) => r.kind === "water");
    // Platforms are sorted by column; the log has drifted past the pad by now, so compare as a set.
    expect(water?.kind === "water" && water.platforms.map((p) => p.type).sort()).toEqual([
      "lily_pad",
      "log",
    ]);
  });

  it("never emits -0", () => {
    const game = new Game({ seed: 3 });
    expect(JSON.stringify(observe(game))).not.toContain("-0,");
    expect(Object.is(observe(game).player.col, -0)).toBe(false);
  });
});
