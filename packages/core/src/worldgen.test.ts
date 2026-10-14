import { describe, expect, it } from "vitest";
import { CAR_WIDTHS, LOG_WIDTHS } from "./constants.ts";
import { createRowGenerator, generateRow, type RowSpec } from "./worldgen.ts";

const SEEDS = Array.from({ length: 150 }, (_, i) => i + 1);

function mapFor(seed: number, rows: number): RowSpec[] {
  const gen = createRowGenerator(seed);
  const out: RowSpec[] = [];
  for (let z = 0; z < rows; z++) out.push(gen(z, out[z - 1]));
  return out;
}

describe("worldgen: ported rules", () => {
  it("rows 0-4 are solid trees and rows 5-9 are grass with walls and 1-3 interior trees", () => {
    for (const seed of SEEDS) {
      const rows = mapFor(seed, 10);
      for (let z = 0; z < 5; z++) {
        const row = rows[z];
        expect(row?.kind).toBe("grass");
        if (row?.kind === "grass") {
          expect(row.solid).toBe(true);
          expect(row.blocked).toEqual([-7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7]);
        }
      }
      for (let z = 5; z < 10; z++) {
        const row = rows[z];
        expect(row?.kind).toBe("grass");
        if (row?.kind !== "grass") continue;
        expect(row.solid).toBe(false);
        for (const wall of [-7, -6, -5, 5, 6, 7]) expect(row.blocked).toContain(wall);
        const interior = row.blocked.filter((x) => Math.abs(x) < 5);
        expect(interior.length).toBeLessThanOrEqual(3);
        expect(interior).not.toContain(0); // upstream never plants a tree on column 0
      }
    }
  });

  it("rows 5-9 still get random interior trees: upstream defines Fill.empty but never uses it", () => {
    let interiorTrees = 0;
    let rowsSeen = 0;
    for (const seed of SEEDS) {
      const row = mapFor(seed, 10)[7];
      if (row?.kind !== "grass") continue;
      interiorTrees += row.blocked.filter((x) => Math.abs(x) < 5).length;
      rowsSeen++;
    }
    // Eight candidate columns at p = 0.4 per draw and a cap of 1-3: the mean is about 2.
    expect(interiorTrees / rowsSeen).toBeGreaterThan(1.5);
    expect(interiorTrees / rowsSeen).toBeLessThan(2.5);
  });

  it("picks row kinds with probabilities grass 1/3, road 1/4, rail 1/12, water 1/3 from row 10 on", () => {
    const counts: Record<string, number> = { grass: 0, road: 0, rail: 0, water: 0 };
    let total = 0;
    for (const seed of SEEDS) {
      for (const row of mapFor(seed, 70).slice(10)) {
        counts[row.kind] = (counts[row.kind] ?? 0) + 1;
        total++;
      }
    }
    const share = (k: string) => (counts[k] ?? 0) / total;
    expect(Math.abs(share("grass") - 1 / 3)).toBeLessThan(0.03);
    expect(Math.abs(share("road") - 1 / 4)).toBeLessThan(0.03);
    expect(Math.abs(share("rail") - 1 / 12)).toBeLessThan(0.02);
    expect(Math.abs(share("water") - 1 / 3)).toBeLessThan(0.03);
  });

  it("roads have 1-2 cars, speed 0.02-0.08 tiles/tick, one direction and 5-8 tile gaps", () => {
    for (const seed of SEEDS) {
      for (const row of mapFor(seed, 80)) {
        if (row.kind !== "road") continue;
        expect(row.cars.length).toBeGreaterThanOrEqual(1);
        expect(row.cars.length).toBeLessThanOrEqual(2);
        const first = row.cars[0];
        if (!first) continue;
        const dir = Math.sign(first.speed);
        for (const car of row.cars) {
          expect(Math.sign(car.speed)).toBe(dir);
          expect(Math.abs(car.speed)).toBeGreaterThanOrEqual(0.02);
          expect(Math.abs(car.speed)).toBeLessThan(0.08);
          expect(CAR_WIDTHS).toContain(car.width);
          expect(car.kind).toBe("car");
        }
        expect(first.x0).toBeCloseTo(-6 * dir, 12);
        const second = row.cars[1];
        if (second) {
          const gap = Math.abs(second.x0 - first.x0);
          expect(gap).toBeGreaterThanOrEqual(5);
          expect(gap).toBeLessThan(8);
        }
      }
    }
  });

  it("water: even rows are static lily pads, odd rows are drifting logs", () => {
    let pads = 0;
    let logs = 0;
    for (const seed of SEEDS) {
      for (const row of mapFor(seed, 80)) {
        if (row.kind !== "water") continue;
        expect(row.items.length).toBeGreaterThanOrEqual(2);
        expect(row.items.length).toBeLessThanOrEqual(3);
        if (row.z % 2 === 0) {
          pads++;
          expect(row.flavor).toBe("lily_pads");
          for (const pad of row.items) {
            expect(pad.speed).toBe(0);
            expect(pad.kind).toBe("lily_pad");
          }
        } else {
          logs++;
          expect(row.flavor).toBe("logs");
          for (const log of row.items) {
            expect(Math.abs(log.speed)).toBeGreaterThanOrEqual(0.02);
            expect(Math.abs(log.speed)).toBeLessThan(0.07);
            expect(LOG_WIDTHS).toContain(log.width);
          }
        }
      }
    }
    expect(pads).toBeGreaterThan(50);
    expect(logs).toBeGreaterThan(50);
  });

  it("keeps lily pads and grass connected in both directions (winnable maps)", () => {
    let waterAfterGrass = 0;
    let grassAfterWater = 0;
    for (const seed of SEEDS) {
      const rows = mapFor(seed, 120);
      for (let z = 1; z < rows.length; z++) {
        const row = rows[z];
        const prev = rows[z - 1];
        if (row?.kind === "water" && row.flavor === "lily_pads" && prev?.kind === "grass") {
          waterAfterGrass++;
          const clear = [-4, -3, -2, -1, 0, 1, 2, 3, 4].filter((x) => !prev.blocked.includes(x));
          expect(row.lilyPadCols.some((c) => clear.includes(c))).toBe(true);
        }
        if (row?.kind === "grass" && prev?.kind === "water") {
          grassAfterWater++;
          for (const col of prev.lilyPadCols) expect(row.blocked).not.toContain(col);
        }
      }
    }
    expect(waterAfterGrass).toBeGreaterThan(20);
    expect(grassAfterWater).toBeGreaterThan(20);
  });

  it("trains run at 0.8 tiles/tick with a 20 or 25 tile hit width", () => {
    const widths = new Set<number>();
    for (const seed of SEEDS) {
      for (const row of mapFor(seed, 120)) {
        if (row.kind !== "rail") continue;
        expect(row.train.speed).toBe(0.8);
        expect(row.train.x0).toBeGreaterThanOrEqual(-110);
        expect(row.train.x0).toBeLessThan(110);
        widths.add(row.train.width);
      }
    }
    expect([...widths].sort()).toEqual([20, 25]);
  });

  it("generates a row from (seed, z, previous row) only, in any order", () => {
    for (const seed of [3, 99, 4242]) {
      const rows = mapFor(seed, 60);
      for (const z of [59, 12, 33, 10, 45]) {
        expect(generateRow(seed, z, rows[z - 1])).toEqual(rows[z]);
      }
    }
  });

  it("different seeds give different maps", () => {
    expect(JSON.stringify(mapFor(1, 60))).not.toEqual(JSON.stringify(mapFor(2, 60)));
  });
});
