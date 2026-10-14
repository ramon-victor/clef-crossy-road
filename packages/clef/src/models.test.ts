import { describe, expect, it } from "vitest";
import {
  CLEF_MODELS,
  FREE_NEURONS_PER_DAY,
  neuronsForTokens,
  USD_PER_MILLION_INPUT_TOKENS,
  usdForTokens,
} from "./models.ts";

describe("cost model", () => {
  it("reproduces the published neurons-per-million-token figures", () => {
    expect(neuronsForTokens("clef-flash", 1_000_000)).toBeCloseTo(3454.5, 0);
    expect(neuronsForTokens("clef", 1_000_000)).toBeCloseTo(21818, 0);
    expect(usdForTokens("clef-flash", 1_000_000)).toBeCloseTo(0.038, 6);
  });

  it("charges nothing for no tokens and scales linearly", () => {
    expect(neuronsForTokens("clef", 0)).toBe(0);
    expect(neuronsForTokens("clef-flash", 2_000)).toBeCloseTo(
      2 * neuronsForTokens("clef-flash", 1_000),
      10,
    );
  });

  it("has a price for every model it knows, and the free tier is 10,000 neurons a day", () => {
    for (const model of CLEF_MODELS) expect(USD_PER_MILLION_INPUT_TOKENS[model]).toBeGreaterThan(0);
    expect(FREE_NEURONS_PER_DAY).toBe(10_000);
  });
});
