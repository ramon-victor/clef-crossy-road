import { describe, expect, it } from "vitest";
import {
  csv,
  intOption,
  optionalIntOption,
  optionalNumberOption,
  parseCli,
  runNames,
} from "./options.ts";

describe("parseCli", () => {
  it("splits the command from its options", () => {
    const { command, values } = parseCli([
      "run",
      "--run",
      "x",
      "--policies",
      "a,b",
      "--seeds",
      "1..2",
    ]);
    expect(command).toBe("run");
    expect(values).toMatchObject({ run: "x", policies: "a,b", seeds: "1..2" });
  });

  it("has no command when there are no arguments", () => {
    expect(parseCli([]).command).toBeUndefined();
  });

  it("rejects an option it does not know", () => {
    expect(() => parseCli(["run", "--turbo", "1"])).toThrow();
  });
});

describe("numeric options", () => {
  it("uses the fallback only when the option is absent", () => {
    expect(intOption("max-calls", undefined, 1500)).toBe(1500);
    expect(intOption("max-calls", "20", 1500)).toBe(20);
    expect(optionalIntOption("min-score", undefined)).toBeUndefined();
  });

  it.each(["abc", "", " ", "1.5", "-1", "Infinity"])(
    "rejects %j instead of becoming NaN",
    (raw) => {
      expect(() => intOption("max-calls", raw, 1500)).toThrow(/Bad --max-calls/);
    },
  );

  it("enforces the minimum", () => {
    expect(() => intOption("concurrency", "0", 1, 1)).toThrow(/>= 1/);
    expect(intOption("stall-limit", "0", 40)).toBe(0);
  });

  it("accepts decimals only where they make sense", () => {
    expect(optionalNumberOption("assume-decisions", "3.5")).toBe(3.5);
    expect(() => optionalIntOption("min-score", "3.5")).toThrow();
  });
});

describe("lists", () => {
  it("splits and trims comma separated values", () => {
    expect(csv("a, b ,c")).toEqual(["a", "b", "c"]);
  });

  it("requires --run for the commands that read a run", () => {
    expect(runNames({ run: "r1, r2" })).toEqual(["r1", "r2"]);
    expect(() => runNames({})).toThrow(/--run/);
  });
});
