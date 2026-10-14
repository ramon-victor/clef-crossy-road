import { describe, expect, it } from "vitest";
import { decisionCost } from "./cost.ts";

const cost = (encoder: "json" | "grid" | "image", strategy: "choice" | "critic" | "critic-go") =>
  decisionCost({ model: "clef-flash", encoder, strategy });

describe("decisionCost", () => {
  it("uses the token sizes read back from the API", () => {
    expect(cost("json", "choice")).toMatchObject({ tokens: 1120, measured: true });
    expect(cost("grid", "choice")).toMatchObject({ tokens: 1320, measured: true });
    expect(cost("image", "choice")).toMatchObject({ tokens: 972, measured: true });
    expect(cost("json", "critic")).toMatchObject({ tokens: 3070, measured: true });
    expect(cost("json", "critic-go").tokens).toBe(3070);
  });

  it("flags the critic with a picture or a grid as an estimate", () => {
    expect(cost("image", "critic")).toMatchObject({ tokens: 3070, measured: false });
    expect(cost("grid", "critic-go").measured).toBe(false);
  });

  it("prices tokens at the published rate: Clef costs 6.3 times Clef-flash", () => {
    const flash = cost("json", "choice").neurons;
    const large = decisionCost({ model: "clef", encoder: "json", strategy: "choice" }).neurons;
    expect(flash).toBeCloseTo((1120 / 1e6) * 3454.5, 1);
    expect(large / flash).toBeCloseTo(0.24 / 0.038, 5);
  });
});
