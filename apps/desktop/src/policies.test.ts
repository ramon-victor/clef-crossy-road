import { clefPolicyId, decisionCost } from "@ccr/agent";
import { ClefClient } from "@ccr/clef";
import { describe, expect, it } from "vitest";
import {
  buildPolicyChoices,
  CLEF_27B_CONFIG,
  CLEF_27B_ID,
  CLEF_ID,
  canonicalPlayerId,
  customChoice,
  freeSeedRange,
  nextMapSeed,
} from "./policies.ts";

const choices = buildPolicyChoices(null);
const byId = (id: string) => choices.find((c) => c.id === id);
const random = () => 987_654;

describe("who can play", () => {
  it("offers you, the two sizes of Clef, and the references; the other conditions stay in the benchmark", () => {
    expect(choices.map((c) => c.id)).toEqual([
      "human",
      CLEF_ID,
      CLEF_27B_ID,
      "lookahead",
      "always-forward",
      "random",
    ]);
    expect(choices.filter((c) => c.kind === "model")).toHaveLength(2);
  });

  it("each Clef reports that it may spend, and what a decision costs", () => {
    const flash = byId(CLEF_ID);
    const large = byId(CLEF_27B_ID);
    expect(flash?.usesApi).toBe(true);
    expect(flash?.neuronsPerDecision).toBeCloseTo(
      decisionCost({ model: "clef-flash", encoder: "json-fx", strategy: "choice" }).neurons,
      5,
    );
    expect(large?.neuronsPerDecision).toBeCloseTo(
      decisionCost({ model: "clef", encoder: "json-fx", strategy: "choice" }).neurons,
      5,
    );
    for (const c of choices.filter((x) => x.kind !== "model")) expect(c.usesApi).toBe(false);
  });

  it("the 27B costs about six times the Flash and says so, with the same view and question", () => {
    const flash = byId(CLEF_ID)?.neuronsPerDecision ?? 0;
    const large = byId(CLEF_27B_ID);
    expect((large?.neuronsPerDecision ?? 0) / flash).toBeCloseTo(6.3, 1);
    expect(large?.detail).toMatch(/6 times the cost/);
    expect(CLEF_27B_CONFIG).toMatchObject({ model: "clef", encoder: "json-fx", manual: "full" });
  });

  it("has no Clef to play until a client exists", () => {
    expect(byId(CLEF_ID)?.factory).toBeNull();
    expect(byId(CLEF_27B_ID)?.factory).toBeNull();
  });
});

describe("ids from shortcuts", () => {
  it("the old `clef` means Clef-flash", () => {
    expect(canonicalPlayerId("clef")).toBe(CLEF_ID);
    expect(canonicalPlayerId(CLEF_27B_ID)).toBe(CLEF_27B_ID);
    expect(canonicalPlayerId("lookahead")).toBe("lookahead");
  });

  const client = new ClefClient({
    transport: {
      post: async () => {
        throw new Error("never");
      },
    },
  });

  it("a benchmark id becomes a custom player with its own id and cost, nothing cached", () => {
    const custom = customChoice("clef:clef-flash:view-fx:choice:routing", client);
    expect(custom).toMatchObject({
      id: "clef:clef-flash:view-fx:choice:routing",
      kind: "model",
      usesApi: true,
    });
    expect(custom?.label).toContain("Custom");
    expect(custom?.freeReplay).toBeUndefined();
    expect(custom?.factory).not.toBeNull();
    expect(custom?.neuronsPerDecision).toBeGreaterThan(0);
  });

  it("fills in the default style, so the id is the full one", () => {
    expect(customChoice("clef:clef-flash:json:choice", client)?.id).toBe(
      "clef:clef-flash:json:choice:full",
    );
  });

  it("gives nothing for ids that are not valid, and for the two standard players", () => {
    expect(customChoice("lookahead", client)).toBeUndefined();
    expect(customChoice("clef:gpt:json:choice", client)).toBeUndefined();
    expect(customChoice("clef:clef-flash:video:choice", client)).toBeUndefined();
    expect(customChoice(clefPolicyId(CLEF_27B_CONFIG), client)).toBeUndefined();
    expect(customChoice("clef:clef-flash:json-fx:choice:full", client)).toBeUndefined();
  });
});

describe("free replay seeds", () => {
  it("parses the cached range of each Clef and nothing for free players", () => {
    expect(freeSeedRange(byId(CLEF_ID))).toEqual({ min: 1, max: 100 });
    expect(freeSeedRange(byId(CLEF_27B_ID))).toEqual({ min: 1, max: 8 });
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
    expect(nextMapSeed(byId(CLEF_27B_ID), 8, random)).toEqual({ seed: 987_654, free: false });
  });

  it("free players always get a random map", () => {
    expect(nextMapSeed(byId("lookahead"), undefined, random)).toEqual({
      seed: 987_654,
      free: false,
    });
    expect(nextMapSeed(byId("human"), 3, random).free).toBe(false);
  });
});
