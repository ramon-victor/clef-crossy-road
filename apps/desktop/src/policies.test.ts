import { describe, expect, it } from "vitest";
import { buildPolicyChoices, freeSeedRange, nextMapSeed } from "./policies.ts";

const choices = buildPolicyChoices(null);
const byId = (id: string) => choices.find((c) => c.id === id);
const random = () => 987_654;

describe("free replay seeds", () => {
  it("parses the cached range of each model and nothing for free players", () => {
    expect(freeSeedRange(byId("clef-flash-json"))).toEqual({ min: 1, max: 100 });
    expect(freeSeedRange(byId("clef-27b-json"))).toEqual({ min: 1, max: 40 });
    expect(freeSeedRange(byId("lookahead"))).toBeNull();
    expect(freeSeedRange(undefined)).toBeNull();
  });

  it("'New map' walks through the cached seeds in order, so it keeps costing nothing", () => {
    const flash = byId("clef-flash-json");
    expect(nextMapSeed(flash, undefined, random)).toEqual({ seed: 1, free: true });
    expect(nextMapSeed(flash, 1, random)).toEqual({ seed: 2, free: true });
    expect(nextMapSeed(flash, 99, random)).toEqual({ seed: 100, free: true });
  });

  it("only after the cached seeds are used up does it fall back to a random (paid) map", () => {
    expect(nextMapSeed(byId("clef-flash-json"), 100, random)).toEqual({
      seed: 987_654,
      free: false,
    });
    expect(nextMapSeed(byId("clef-27b-json"), 40, random)).toEqual({ seed: 987_654, free: false });
  });

  it("free players always get a random map", () => {
    expect(nextMapSeed(byId("lookahead"), undefined, random)).toEqual({
      seed: 987_654,
      free: false,
    });
    expect(nextMapSeed(byId("human"), 3, random).free).toBe(false);
  });

  it("prices a decision from the measured tokens: critic costs more, the 27B about 6.3 times", () => {
    const cost = (id: string) => byId(id)?.neuronsPerDecision ?? 0;
    expect(cost("clef-flash-critic")).toBeGreaterThan(cost("clef-flash-json") * 2);
    expect(cost("clef-27b-json") / cost("clef-flash-json")).toBeCloseTo(6.32, 1);
  });

  it("every model player advertises a range and reports that it may spend", () => {
    for (const c of choices.filter((x) => x.kind === "model")) {
      expect(c.usesApi).toBe(true);
      expect(freeSeedRange(c)).not.toBeNull();
      expect(c.neuronsPerDecision).toBeGreaterThan(0);
    }
    for (const c of choices.filter((x) => x.kind !== "model")) expect(c.usesApi).toBe(false);
  });
});
