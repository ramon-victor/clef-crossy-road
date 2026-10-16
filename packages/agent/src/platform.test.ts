import type { Observation, ObsRow } from "@ccr/core";
import { describe, expect, it } from "vitest";
import {
  driftingOff,
  EDGE_A_MOMENT,
  EDGE_SOON,
  edgeWord,
  ridingSpeed,
  secondsToEdge,
  secondsToLimit,
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
  it("is the distance to the edge it is carried towards over its speed", () => {
    expect(secondsToEdge(riding(3, 2))).toBeCloseTo(1, 5); // 2 columns to go at 2 columns per second
    expect(secondsToEdge(riding(-3, -4))).toBeCloseTo(0.5, 5);
    expect(secondsToEdge(riding(0, 1))).toBeCloseTo(5, 5);
  });

  it("is infinite when the platform stands still, or the chicken is not on one", () => {
    expect(secondsToEdge(riding(4, 0))).toBe(Number.POSITIVE_INFINITY);
    expect(secondsToEdge(onGrass(4))).toBe(Number.POSITIVE_INFINITY);
    expect(ridingSpeed(onGrass(4))).toBe(0);
  });

  it("does not count the far edge: a platform carried away from the nearer edge goes the long way", () => {
    expect(secondsToEdge(riding(-4, 2))).toBeCloseTo(4.5, 5);
  });

  it("is zero once the chicken is past the edge", () => {
    expect(secondsToLimit(5.5, 1, 5)).toBe(0);
  });
});

describe("edgeWord: the clock in a word", () => {
  it("has four bands and no digits", () => {
    expect(edgeWord(0)).toBe("a_moment");
    expect(edgeWord(EDGE_A_MOMENT - 0.01)).toBe("a_moment");
    expect(edgeWord(EDGE_A_MOMENT)).toBe("soon");
    expect(edgeWord(EDGE_SOON - 0.01)).toBe("soon");
    expect(edgeWord(EDGE_SOON)).toBe("later");
    expect(edgeWord(Number.POSITIVE_INFINITY)).toBe("not_carried");
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
