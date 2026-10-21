import { ClefClient, type Transport } from "@ccr/clef";
import { describe, expect, it } from "vitest";
import { isClefPolicy, parsePolicy, parseSeeds } from "./registry.ts";

const noClient = () => {
  throw new Error("no client for baselines");
};

describe("parseSeeds", () => {
  it.each([
    ["1..3", [1, 2, 3]],
    ["5", [5]],
    ["1..2,9", [1, 2, 9]],
    [" 4 , 6..7 ", [4, 6, 7]],
  ])("reads %s", (spec, seeds) => {
    expect(parseSeeds(spec)).toEqual(seeds);
  });

  it.each(["a", "5..1", "1..", "-3", ""])("rejects %j", (spec) => {
    expect(() => parseSeeds(spec)).toThrow();
  });
});

describe("parsePolicy: the scripted players of the words view", () => {
  it("builds rule-lanes, exec-cross and exec-rules without a client", () => {
    for (const id of ["rule-lanes", "exec-cross", "exec-rules"]) {
      expect(parsePolicy(id, noClient).id).toBe(id);
      expect(isClefPolicy(id)).toBe(false);
    }
  });

  it("reads the model conditions of the words view and refuses the ones that mean nothing", () => {
    const transport: Transport = { post: async () => ({ status: 200, json: {} }) };
    const client = () => new ClefClient({ transport });
    expect(parsePolicy("clef:clef-flash:lanes:choice:rules", client).id).toBe(
      "clef:clef-flash:lanes:choice:rules",
    );
    expect(parsePolicy("clef:clef-flash:lanes:maneuver:rules", client).id).toBe(
      "clef:clef-flash:lanes:maneuver:rules",
    );
    expect(() => parsePolicy("clef:clef-flash:json:maneuver:rules", client)).toThrow();
  });
});

describe("parsePolicy", () => {
  it("builds baselines without ever asking for a client", () => {
    for (const id of [
      "always-forward",
      "random",
      "lookahead",
      "lookahead-2",
      "lookahead-comp:300",
      "rule-view",
      "rule-view-fx",
    ]) {
      expect(parsePolicy(id, noClient).id).toBe(id);
    }
  });

  it("builds a Clef policy from its id, with the manual defaulting to full", () => {
    const transport: Transport = { post: async () => ({ status: 200, json: null }) };
    const client = new ClefClient({ transport });
    expect(parsePolicy("clef:clef-flash:grid:critic", () => client).id).toBe(
      "clef:clef-flash:grid:critic:full",
    );
    expect(isClefPolicy("clef:clef:json:choice")).toBe(true);
    expect(isClefPolicy("lookahead")).toBe(false);
  });

  it("reads the bare `clef` as the default Clef and records the spelled-out id", () => {
    const transport: Transport = { post: async () => ({ status: 200, json: null }) };
    const client = new ClefClient({ transport });
    expect(isClefPolicy("clef")).toBe(true);
    expect(parsePolicy("clef", () => client).id).toBe("clef:clef-flash:scene:route-live:lookup");
  });

  it("rejects unknown and malformed ids", () => {
    expect(() => parsePolicy("nope", noClient)).toThrow(/Unknown policy/);
    expect(() =>
      parsePolicy(
        "clef:gpt:json:choice",
        () => new ClefClient({ transport: { post: async () => ({ status: 200, json: null }) } }),
      ),
    ).toThrow(/model/);
  });
});

describe("parsePolicy: the route strategy and its free reference", () => {
  it("builds exec-route without a client, and reads the route condition", () => {
    expect(parsePolicy("exec-route", noClient).id).toBe("exec-route");
    expect(isClefPolicy("exec-route")).toBe(false);
    const transport: Transport = { post: async () => ({ status: 200, json: {} }) };
    const client = () => new ClefClient({ transport });
    expect(parsePolicy("clef:clef-flash:scene:route:lookup", client).id).toBe(
      "clef:clef-flash:scene:route:lookup",
    );
    expect(() => parsePolicy("clef:clef-flash:json:route:lookup", client)).toThrow();
  });
});
