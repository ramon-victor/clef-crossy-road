import { describe, expect, it } from "vitest";
import { isSeed, parseSeedText, randomSeed } from "./seed.ts";

describe("seeds", () => {
  it("accept exactly the unsigned 32-bit integers", () => {
    expect([0, 1, 4_294_967_295].every(isSeed)).toBe(true);
    for (const bad of [-1, 1.5, 4_294_967_296, Number.NaN, "7", null, undefined]) {
      expect(isSeed(bad)).toBe(false);
    }
  });

  it("are read from what the user typed, with a blank box meaning nothing rather than seed 0", () => {
    expect(parseSeedText(" 42 ")).toBe(42);
    expect(parseSeedText("0")).toBe(0);
    for (const bad of ["", "   ", "abc", "-3", "1.5", "4294967296"]) {
      expect(parseSeedText(bad)).toBeUndefined();
    }
  });

  it("are random but short enough to type", () => {
    for (let i = 0; i < 50; i++) {
      const seed = randomSeed();
      expect(isSeed(seed) && seed < 1_000_000).toBe(true);
    }
  });
});
