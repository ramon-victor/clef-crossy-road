import { decisionCost } from "@ccr/agent";
import { describe, expect, it } from "vitest";
import { buildPolicyChoices, CLEF_ID, freeSeedRange, nextMapSeed } from "./policies.ts";

const choices = buildPolicyChoices(null);
const byId = (id: string) => choices.find((c) => c.id === id);
const random = () => 987_654;

describe("who can play", () => {
  it("offers you, one Clef, and the references; the experiment conditions stay in the benchmark", () => {
    expect(choices.map((c) => c.id)).toEqual([
      "human",
      CLEF_ID,
      "lookahead",
      "always-forward",
      "random",
    ]);
    expect(choices.filter((c) => c.kind === "model")).toHaveLength(1);
  });

  it("the Clef reports that it may spend, and what a decision costs", () => {
    const clef = byId(CLEF_ID);
    expect(clef?.usesApi).toBe(true);
    expect(clef?.neuronsPerDecision).toBeCloseTo(
      decisionCost({ model: "clef-flash", encoder: "json", strategy: "choice" }).neurons,
      5,
    );
    for (const c of choices.filter((x) => x.kind !== "model")) expect(c.usesApi).toBe(false);
  });

  it("has no Clef to play until a client exists", () => {
    expect(byId(CLEF_ID)?.factory).toBeNull();
  });
});

describe("free replay seeds", () => {
  it("parses the cached range of the Clef and nothing for free players", () => {
    expect(freeSeedRange(byId(CLEF_ID))).toEqual({ min: 1, max: 100 });
    expect(freeSeedRange(byId("lookahead"))).toBeNull();
    expect(freeSeedRange(undefined)).toBeNull();
  });

  it("'New map' walks through the cached seeds in order, so it keeps costing nothing", () => {
    const clef = byId(CLEF_ID);
    expect(nextMapSeed(clef, undefined, random)).toEqual({ seed: 1, free: true });
    expect(nextMapSeed(clef, 1, random)).toEqual({ seed: 2, free: true });
    expect(nextMapSeed(clef, 99, random)).toEqual({ seed: 100, free: true });
  });

  it("only after the cached seeds are used up does it fall back to a random (paid) map", () => {
    expect(nextMapSeed(byId(CLEF_ID), 100, random)).toEqual({ seed: 987_654, free: false });
  });

  it("free players always get a random map", () => {
    expect(nextMapSeed(byId("lookahead"), undefined, random)).toEqual({
      seed: 987_654,
      free: false,
    });
    expect(nextMapSeed(byId("human"), 3, random).free).toBe(false);
  });
});
