import { clefPolicyId, DEFAULT_CLEF, decisionCost } from "@ccr/agent";
import { ClefClient } from "@ccr/clef";
import { describe, expect, it } from "vitest";
import { playerText } from "./i18n/presentation.ts";
import { translator } from "./i18n/translate.ts";
import {
  buildPolicyChoices,
  CLEF_27B_CONFIG,
  CLEF_27B_ID,
  CLEF_CACHED_SEEDS,
  CLEF_ID,
  canonicalPlayerId,
  customChoice,
  freeSeedRange,
  nextMapSeed,
} from "./policies.ts";

const choices = buildPolicyChoices(null);
const byId = (id: string) => choices.find((c) => c.id === id);
const random = () => 987_654;
const textFor = (id: string) => {
  const choice = byId(id);
  return choice ? playerText(choice, translator("en")) : null;
};

describe("who can play", () => {
  it("offers you, the two sizes of Clef and the references; every other condition stays in the benchmark", () => {
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

  it("both Clef play the gameplay of ADR-0011: the scene view, three lookups and the route controller", () => {
    expect(DEFAULT_CLEF).toEqual({
      model: "clef-flash",
      encoder: "scene",
      strategy: "route",
      manual: "lookup",
    });
    expect(CLEF_27B_CONFIG).toEqual({ ...DEFAULT_CLEF, model: "clef" });
    expect(textFor(CLEF_ID)?.detail).toMatch(/controller/);
    expect(textFor(CLEF_ID)?.detail).toMatch(/words/);
    expect(textFor(CLEF_27B_ID)?.detail).toMatch(/same gameplay/);
  });

  it("each Clef reports that it may spend, and what a question set costs", () => {
    const flash = byId(CLEF_ID);
    const large = byId(CLEF_27B_ID);
    expect(flash?.usesApi).toBe(true);
    expect(flash?.neuronsPerDecision).toBeCloseTo(decisionCost(DEFAULT_CLEF).neurons, 5);
    expect(large?.neuronsPerDecision).toBeCloseTo(decisionCost(CLEF_27B_CONFIG).neurons, 5);
    for (const c of choices.filter((x) => x.kind !== "model")) expect(c.usesApi).toBe(false);
  });

  it("the 27B costs about six times the Flash and says so, and has no cached map", () => {
    const flash = byId(CLEF_ID)?.neuronsPerDecision ?? 0;
    const large = byId(CLEF_27B_ID);
    expect((large?.neuronsPerDecision ?? 0) / flash).toBeCloseTo(6.3, 1);
    expect(textFor(CLEF_27B_ID)?.detail).toMatch(/6 times the cost/);
    expect(large?.freeReplay).toBeUndefined();
  });

  it("has no Clef to play until a client exists", () => {
    expect(byId(CLEF_ID)?.factory).toBeNull();
    expect(byId(CLEF_27B_ID)?.factory).toBeNull();
  });
});

describe("ids from shortcuts", () => {
  it("the old `clef` and `clef-words` mean Clef-flash", () => {
    expect(canonicalPlayerId("clef")).toBe(CLEF_ID);
    expect(canonicalPlayerId("clef-words")).toBe(CLEF_ID);
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
    const custom = customChoice("clef:clef-flash:json-fx:choice:full", client);
    expect(custom).toMatchObject({
      id: "clef:clef-flash:json-fx:choice:full",
      kind: "model",
      usesApi: true,
    });
    expect(custom && playerText(custom, translator("en")).label).toContain("Custom");
    expect(custom?.freeReplay).toBeUndefined();
    expect(custom?.factory).not.toBeNull();
    expect(custom?.neuronsPerDecision).toBeGreaterThan(0);
  });

  it("the first twelve conditions of the benchmark are still there, as custom players", () => {
    expect(customChoice("clef:clef-flash:view-fx:choice:routing", client)?.id).toBe(
      "clef:clef-flash:view-fx:choice:routing",
    );
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
    expect(customChoice(clefPolicyId(DEFAULT_CLEF), client)).toBeUndefined();
  });
});

describe("free replay seeds", () => {
  it("parses the cached range of Clef-flash, and nothing for the 27B and the free players", () => {
    const range = freeSeedRange(byId(CLEF_ID));
    expect(CLEF_CACHED_SEEDS).toMatch(/^\d+-\d+$/);
    expect(range?.min).toBeLessThanOrEqual(range?.max ?? 0);
    expect(freeSeedRange(byId(CLEF_27B_ID))).toBeNull();
    expect(freeSeedRange(byId("lookahead"))).toBeNull();
    expect(freeSeedRange(undefined)).toBeNull();
  });

  it("'New map' walks through the cached seeds in order, so it keeps costing nothing", () => {
    const clef = byId(CLEF_ID);
    if (!clef) throw new Error("expected the Clef-flash player");
    for (const choice of [clef, { ...clef, freeReplay: "10-12" }]) {
      const range = freeSeedRange(choice);
      if (!range) throw new Error("expected a cached seed range");
      expect(nextMapSeed(choice, undefined, random)).toEqual({ seed: range.min, free: true });
      for (let seed = range.min; seed < range.max; seed++) {
        expect(nextMapSeed(choice, seed, random)).toEqual({ seed: seed + 1, free: true });
      }
      expect(nextMapSeed(choice, range.max, random)).toEqual({ seed: random(), free: false });
    }
  });

  it("only after the cached seeds are used up does it fall back to a random (paid) map", () => {
    const range = freeSeedRange(byId(CLEF_ID)) ?? { min: 0, max: 0 };
    expect(nextMapSeed(byId(CLEF_ID), range.max, random)).toEqual({ seed: 987_654, free: false });
    expect(nextMapSeed(byId(CLEF_27B_ID), undefined, random)).toEqual({
      seed: 987_654,
      free: false,
    });
  });

  it("free players always get a random map", () => {
    expect(nextMapSeed(byId("lookahead"), undefined, random)).toEqual({
      seed: 987_654,
      free: false,
    });
    expect(nextMapSeed(byId("human"), 3, random).free).toBe(false);
  });
});
