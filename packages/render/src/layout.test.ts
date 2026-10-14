import { describe, expect, it } from "vitest";
import {
  cameraTargetX,
  DROWNED_Y,
  FOLLOW_PER_FRAME,
  facingFor,
  followFactor,
  heroY,
  hopArc,
  hopStretch,
  PLATFORM_TOP,
  ROW_TOP,
  shortestAngle,
  standingHeight,
  trainLightPhase,
} from "./layout.ts";

describe("standingHeight", () => {
  it("is the floor of the row the hero is over, or grass where nothing is built yet", () => {
    expect(standingHeight("road", null, false)).toBe(ROW_TOP.road);
    expect(standingHeight("rail", null, false)).toBe(ROW_TOP.rail);
    expect(standingHeight("grass", null, false)).toBe(ROW_TOP.grass);
    expect(standingHeight(undefined, null, false)).toBe(ROW_TOP.grass);
  });

  it("on water is the platform carrying the hero, else the surface, else the river bed once drowned", () => {
    expect(standingHeight("water", "log", false)).toBe(PLATFORM_TOP.log);
    expect(standingHeight("water", "lily_pad", false)).toBe(PLATFORM_TOP.lilyPad);
    expect(standingHeight("water", null, false)).toBe(ROW_TOP.water);
    expect(standingHeight("water", null, true)).toBe(DROWNED_Y);
  });

  it("ignores a ride or a drowning that is not on water", () => {
    expect(standingHeight("road", "log", true)).toBe(ROW_TOP.road);
  });
});

describe("camera follow", () => {
  it("moves 3% per frame at 60 Hz, like the original", () => {
    expect(followFactor(1 / 60)).toBeCloseTo(FOLLOW_PER_FRAME, 10);
  });

  it("is frame-rate independent: two half steps equal one full step", () => {
    const full = followFactor(1 / 30);
    const half = followFactor(1 / 60);
    expect(1 - (1 - half) * (1 - half)).toBeCloseTo(full, 10);
  });

  it("never moves backwards and clamps absurd frame times below 1", () => {
    expect(followFactor(-1)).toBe(0);
    expect(followFactor(1000)).toBeLessThanOrEqual(1);
  });

  it("clamps the camera x like GameEngine.forwardScene", () => {
    expect(cameraTargetX(0)).toBe(-0);
    expect(cameraTargetX(10)).toBe(-3);
    expect(cameraTargetX(-10)).toBe(2);
    expect(cameraTargetX(1.5)).toBe(-1.5);
  });
});

describe("hop animation", () => {
  it("starts and ends on the ground and peaks in the middle", () => {
    expect(hopArc(0)).toBe(0);
    expect(hopArc(1)).toBe(0);
    expect(hopArc(0.5)).toBeCloseTo(0.5, 10);
    expect(hopArc(0.25)).toBeCloseTo(hopArc(0.75), 10);
    expect(hopArc(-1)).toBe(0);
    expect(hopArc(2)).toBe(0);
  });

  it("stretches during the jump and is neutral at rest", () => {
    expect(hopStretch(0)).toBeCloseTo(1, 10);
    expect(hopStretch(1)).toBeCloseTo(1, 10);
    expect(hopStretch(0.5)).toBeGreaterThan(1);
  });

  it("adds the arc only while hopping", () => {
    expect(heroY(0.4, null)).toBe(0.4);
    expect(heroY(0.4, 0.5)).toBeCloseTo(0.9, 10);
  });
});

describe("hero facing", () => {
  it("matches upstream's rotations: forward 0, back PI, left +PI/2, right -PI/2", () => {
    expect(facingFor(0, 1, 5)).toBe(0);
    expect(facingFor(0, -1, 5)).toBe(Math.PI);
    expect(facingFor(1, 0, 5)).toBe(Math.PI / 2);
    expect(facingFor(-1, 0, 5)).toBe(-Math.PI / 2);
    expect(facingFor(0, 0, 1.25)).toBe(1.25);
  });

  it("turns the short way round", () => {
    expect(shortestAngle(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2, 10);
    expect(shortestAngle(Math.PI * 0.9, -Math.PI * 0.9)).toBeCloseTo(Math.PI * 0.2, 10);
    expect(shortestAngle(-Math.PI * 0.9, Math.PI * 0.9)).toBeCloseTo(-Math.PI * 0.2, 10);
    expect(shortestAngle(0, 2 * Math.PI)).toBeCloseTo(0, 10);
  });
});

describe("train lights", () => {
  it("alternates every 12 ticks (200 ms)", () => {
    expect(trainLightPhase(0)).toBe(0);
    expect(trainLightPhase(11)).toBe(0);
    expect(trainLightPhase(12)).toBe(1);
    expect(trainLightPhase(24)).toBe(0);
  });
});
