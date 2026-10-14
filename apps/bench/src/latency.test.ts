import { alwaysForward, type LatencyModel } from "@ccr/agent";
import { describe, expect, it } from "vitest";
import { isPipelinedPolicyId, latencySuffix, parseLatency, withLatencySuffix } from "./latency.ts";

const SPECS: [string, LatencyModel, string][] = [
  ["fixed:300", { kind: "fixed", ms: 300 }, "@lat300"],
  ["fixed:300:pipelined", { kind: "fixed", ms: 300, pipelined: true }, "@latp300"],
  ["recorded", { kind: "recorded" }, "@latrec"],
  ["recorded:pipelined", { kind: "recorded", pipelined: true }, "@latprec"],
];

describe("parseLatency", () => {
  it.each(SPECS)("reads %s", (spec, model) => {
    expect(parseLatency(spec)).toEqual(model);
  });

  it("treats none and no value as no latency", () => {
    expect(parseLatency(undefined)).toBeUndefined();
    expect(parseLatency("none")).toBeUndefined();
  });

  it.each(["fixed", "fixed:abc", "fixed:-5", "slow", "pipelined"])("rejects %j", (spec) => {
    expect(() => parseLatency(spec)).toThrow(/Bad --latency/);
  });
});

describe("latency suffix", () => {
  it.each(SPECS)("%s is told apart in the result id", (_spec, model, suffix) => {
    expect(latencySuffix(model)).toBe(suffix);
    expect(withLatencySuffix(alwaysForward, model).id).toBe(`always-forward${suffix}`);
  });

  it("leaves the policy untouched without latency", () => {
    expect(latencySuffix(undefined)).toBe("");
    expect(withLatencySuffix(alwaysForward, undefined)).toBe(alwaysForward);
  });

  it("is read back by isPipelinedPolicyId, which only a pipelined suffix satisfies", () => {
    for (const [, model] of SPECS) {
      const id = withLatencySuffix(alwaysForward, model).id;
      expect(isPipelinedPolicyId(id)).toBe(model.kind !== "none" && model.pipelined === true);
    }
    expect(isPipelinedPolicyId("always-forward")).toBe(false);
  });
});
