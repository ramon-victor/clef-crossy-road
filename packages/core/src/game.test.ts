import { describe, expect, it } from "vitest";
import { HOP_TICKS, START_ROW } from "./constants.ts";
import { Game } from "./game.ts";
import { hashValue } from "./hash.ts";
import { createRng } from "./rng.ts";
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
import { ACTIONS, type Action } from "./types.ts";
import type { RowSpec } from "./worldgen.ts";

const gameWith = (rows: Record<number, RowSpec>) =>
  new Game({ seed: 1, generator: rowsGenerator(rows) });

const treeAt = (z: number, ...blocked: number[]): RowSpec => ({
  kind: "grass",
  z,
  blocked,
  solid: false,
});

describe("hero movement", () => {
  it("starts on row 8, column 0, alive, with score 0", () => {
    const g = gameWith({});
    expect(g.heroRow).toBe(START_ROW);
    expect(g.heroX).toBe(0);
    expect(g.alive).toBe(true);
    expect(g.score).toBe(0);
  });

  it("a forward hop takes 12 ticks, enters the next row at tick 3 and credits the score at the end", () => {
    const g = gameWith({});
    expect(g.act("hop_forward")).toBe("hop");
    g.advance(2);
    expect(g.heroRow).toBe(8);
    g.advance(1);
    expect(g.heroRow).toBe(9); // ease-out puts z at 8.5625 after 3 ticks
    expect(g.heroMoving).toBe(true);
    expect(g.score).toBe(0);
    g.advance(HOP_TICKS - 3);
    expect(g.heroMoving).toBe(false);
    expect(g.heroRow).toBe(9);
    expect(g.score).toBe(1);
  });

  it("score is the furthest row reached, not the current one", () => {
    const g = gameWith({});
    g.step("hop_forward");
    g.step("hop_forward");
    g.step("hop_back");
    expect(g.heroRow).toBe(START_ROW + 1);
    expect(g.score).toBe(2);
  });

  it("left and right move one column in upstream's x axis (left is +x)", () => {
    const g = gameWith({});
    g.step("hop_left");
    expect(g.heroX).toBe(1);
    g.step("hop_right");
    g.step("hop_right");
    expect(g.heroX).toBe(-1);
  });

  it("stay changes nothing but time", () => {
    const g = gameWith({});
    const result = g.step("stay");
    expect(result.outcome).toBe("stay");
    expect(g.heroRow).toBe(START_ROW);
    expect(g.tick).toBe(HOP_TICKS);
  });

  it("trees block the hop and count as an invalid move", () => {
    const g = gameWith({ 9: treeAt(9, 0) });
    const result = g.step("hop_forward");
    expect(result.outcome).toBe("blocked");
    expect(g.invalidMoves).toBe(1);
    expect(g.heroRow).toBe(START_ROW);
    expect(g.heroMoving).toBe(false);
    expect(g.alive).toBe(true);
  });

  it("a new input mid-hop finishes the hop in flight first, then starts the next one", () => {
    const g = gameWith({});
    g.act("hop_forward");
    g.advance(5);
    expect(g.score).toBe(0);
    g.act("hop_forward");
    expect(g.score).toBe(1); // first hop completed and credited
    g.advance(HOP_TICKS);
    expect(g.heroRow).toBe(START_ROW + 2);
    expect(g.score).toBe(2);
  });

  it("dies out of bounds when |x| > 5 and not before", () => {
    const g = gameWith({});
    for (let i = 0; i < 5; i++) g.step("hop_left");
    expect(g.heroX).toBe(5);
    expect(g.alive).toBe(true);
    g.step("hop_left");
    expect(g.alive).toBe(false);
    expect(g.deathCause).toBe("out_of_bounds");
  });

  it("ignores further actions after death", () => {
    const g = gameWith({});
    for (let i = 0; i < 6; i++) g.step("hop_left");
    expect(g.alive).toBe(false);
    const x = g.heroX;
    expect(g.step("hop_right").outcome).toBe("ignored");
    expect(g.heroX).toBe(x);
  });
});

describe("hazards", () => {
  it("a car on the target row kills the hero mid-hop and the hop is not credited", () => {
    const g = gameWith({ 9: roadRow(9, [carAt(0)]) });
    g.act("hop_forward");
    g.advance(2);
    expect(g.alive).toBe(true); // still rounds to row 8
    g.advance(1);
    expect(g.alive).toBe(false); // tick 3: z = 8.56 rounds to 9, the car is in the way
    expect(g.deathCause).toBe("car");
    expect(g.score).toBe(0);
    expect(g.heroMoving).toBe(false);
  });

  it("a car that is far away does not matter", () => {
    const g = gameWith({ 9: roadRow(9, [carAt(6)]) });
    g.step("hop_forward");
    expect(g.alive).toBe(true);
    expect(g.score).toBe(1);
  });

  it("a moving car runs a waiting hero over", () => {
    // Car starts 6 tiles away moving at 0.05 tiles/tick: reaches the hero's zone in ~100 ticks.
    const g = gameWith({ 8: roadRow(8, [carAt(-6, 0.05)]) });
    let ticks = 0;
    while (g.alive && ticks < 600) {
      g.advance(1);
      ticks++;
    }
    expect(g.deathCause).toBe("car");
    expect(ticks).toBeGreaterThan(80);
    expect(ticks).toBeLessThan(130);
  });

  it("drowns on water without a platform, but only once the hop has finished", () => {
    const g = gameWith({ 9: waterRow(9, [padAt(5)], "lily_pads") });
    g.act("hop_forward");
    g.advance(HOP_TICKS - 1);
    expect(g.alive).toBe(true);
    g.advance(1);
    expect(g.alive).toBe(false);
    expect(g.deathCause).toBe("water");
    expect(g.tick).toBe(HOP_TICKS);
  });

  it("a lily pad under the landing column saves the hero", () => {
    const g = gameWith({ 9: waterRow(9, [padAt(0)], "lily_pads") });
    g.step("hop_forward");
    expect(g.alive).toBe(true);
    expect(g.heroRiding).toBe(true);
    expect(g.score).toBe(1);
  });

  it("a drifting log carries the hero with it", () => {
    const speed = 0.05;
    const g = gameWith({ 9: waterRow(9, [logAt(0, speed)], "logs") });
    g.step("hop_forward"); // lands at tick 12 and already rides during that update
    const xAfterLanding = g.heroX;
    g.advance(20);
    expect(g.alive).toBe(true);
    expect(g.heroX - xAfterLanding).toBeCloseTo(20 * speed, 9);
  });

  it("riding a log out of the frame kills the hero", () => {
    const g = gameWith({ 9: waterRow(9, [logAt(0, 0.05)], "logs") });
    g.step("hop_forward");
    g.advance(400);
    expect(g.alive).toBe(false);
    expect(g.deathCause).toBe("out_of_bounds");
  });

  it("hopping off a log rounds the column when moving forward", () => {
    const g = gameWith({ 9: waterRow(9, [logAt(0, 0.05)], "logs") });
    g.step("hop_forward");
    g.advance(7);
    expect(Number.isInteger(g.heroX)).toBe(false);
    g.step("hop_forward");
    expect(Number.isInteger(g.heroX)).toBe(true);
  });

  it("a train kills only after the hop has finished, with a wide hit zone", () => {
    const g = gameWith({ 9: railRow(9, trainAt(0, 0.8, 110)) });
    g.act("hop_forward");
    g.advance(HOP_TICKS - 1);
    expect(g.alive).toBe(true);
    g.advance(1);
    expect(g.alive).toBe(false);
    expect(g.deathCause).toBe("train");
  });

  it("a train that is outside its hit zone lets the hero cross", () => {
    const g = gameWith({ 9: railRow(9, trainAt(60, 0, 110)) });
    g.step("hop_forward");
    expect(g.alive).toBe(true);
  });
});

describe("determinism", () => {
  function randomRun(seed: number, steps: number, actionSeed: number) {
    const game = new Game({ seed });
    const rng = createRng(actionSeed, 0);
    for (let i = 0; i < steps && game.alive; i++) {
      // Biased to move forward so the run reaches roads, rivers and rails.
      const roll = rng.next();
      const action: Action =
        roll < 0.55 ? "hop_forward" : (ACTIONS[rng.int(ACTIONS.length)] as Action);
      game.step(action);
    }
    return game;
  }

  it("same seed and same actions give identical snapshots", () => {
    for (const seed of [1, 7, 12345, 4_000_000_000]) {
      const a = randomRun(seed, 300, 99);
      const b = randomRun(seed, 300, 99);
      expect(hashValue(a.snapshot())).toBe(hashValue(b.snapshot()));
      expect(a.score).toBe(b.score);
    }
  });

  it("different seeds give different worlds", () => {
    const a = new Game({ seed: 1 }).snapshot();
    const b = new Game({ seed: 2 }).snapshot();
    expect(hashValue(a)).not.toBe(hashValue(b));
  });

  it("does not depend on which rows were looked at first", () => {
    const a = new Game({ seed: 77 });
    const b = new Game({ seed: 77 });
    b.row(60); // force a far row (and everything below it) to exist before any play
    for (const g of [a, b]) {
      g.step("hop_forward");
      g.step("hop_left");
      g.step("hop_forward");
    }
    expect(hashValue(a.snapshot())).toBe(hashValue(b.snapshot()));
  });

  it("clones evolve independently and identically", () => {
    const original = new Game({ seed: 5 });
    original.step("hop_forward");
    const copy = original.clone();
    copy.step("hop_forward");
    copy.step("hop_forward");
    expect(original.score).toBe(1);
    expect(copy.score).toBe(3);

    const twin = original.clone();
    twin.step("hop_forward");
    twin.step("hop_forward");
    expect(hashValue(twin.snapshot())).toBe(hashValue(copy.snapshot()));
  });

  it("plays many random games without throwing", () => {
    let deadByWater = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const g = randomRun(seed, 200, seed + 1000);
      expect(g.score).toBeGreaterThanOrEqual(0);
      if (g.deathCause === "water") deadByWater++;
    }
    expect(deadByWater).toBeGreaterThan(0);
  });
});
