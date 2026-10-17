import type { Observation, ObsRow } from "@ccr/core";
import { describe, expect, it } from "vitest";
import {
  driftingOff,
  EDGE_A_MOMENT,
  EDGE_SOON,
  edgeWord,
  platformClock,
  ridingSpeed,
  secondsToEdge,
} from "./platform.ts";

const log = (col: number, speed: number, half = 2): ObsRow => ({
  dz: 0,
  kind: "water",
  platforms: [{ col, half_extent: half, speed_cols_per_s: speed, type: "log" }],
});

const riding = (col: number, speed: number, half = 2): Observation => ({
  player: { col, standing_on: "water", riding: true, hop_ticks_left: 0 },
  rows: [log(col, speed, half)],
});

const onGrass = (col: number): Observation => ({
  player: { col, standing_on: "grass", riding: false, hop_ticks_left: 0 },
  rows: [{ dz: 0, kind: "grass", blocked_cols: [] }],
});

describe("secondsToEdge: the clock of the platform under the chicken", () => {
  it.each([
    [3, 2, 1],
    [-3, -4, 0.5],
    [0, 1, 5],
    [-4, 2, 4.5],
    [5.5, 1, 0],
  ])(
    "is the distance to the edge it is carried towards over its speed (column %s at %s: %s s)",
    (col, speed, seconds) => {
      expect(secondsToEdge(riding(col, speed))).toBeCloseTo(seconds, 5);
    },
  );

  it("is infinite when the platform stands still, or the chicken is not on one", () => {
    expect(secondsToEdge(riding(4, 0))).toBe(Number.POSITIVE_INFINITY);
    expect(secondsToEdge(onGrass(4))).toBe(Number.POSITIVE_INFINITY);
    expect(ridingSpeed(onGrass(4))).toBe(0);
  });
});

describe("edgeWord: the clock in a word", () => {
  it.each([
    [0, "a_moment"],
    [EDGE_A_MOMENT - 0.01, "a_moment"],
    [EDGE_A_MOMENT, "soon"],
    [EDGE_SOON - 0.01, "soon"],
    [EDGE_SOON, "later"],
    [Number.POSITIVE_INFINITY, "not_carried"],
  ])("puts %s seconds in %s", (seconds, word) => {
    expect(edgeWord(seconds)).toBe(word);
  });
});

describe("driftingOff: the one second in which a platform still gives the chicken a way off", () => {
  it("names the edge it is carried towards when it is less than a second away", () => {
    expect(driftingOff(riding(3, 3, 2.5))).toBe("right");
    expect(driftingOff(riding(-3, -3, 2.5))).toBe("left");
    expect(driftingOff(riding(0, 3, 2.5))).toBe("no");
  });

  it("says nothing of a platform that stands still near the edge", () => {
    expect(driftingOff(riding(4.8, 0))).toBe("no");
  });
});

describe("platformClock: for whoever shows the clock", () => {
  it("says which way the platform goes, how soon, and the word for it", () => {
    expect(platformClock(riding(3, 2))).toEqual({ toward: "right", seconds: 1, word: "soon" });
    expect(platformClock(riding(-4, -4))).toMatchObject({ toward: "left", word: "a_moment" });
  });

  it("has nothing to say off a platform or on one that stands still", () => {
    expect(platformClock(onGrass(0))).toBeNull();
    expect(platformClock(riding(2, 0))).toBeNull();
  });
});
