import { describe, expect, it } from "vitest";
import { meterLevel, ms, percent } from "./format.ts";

describe("format", () => {
  it("shows a dash for what is not known yet", () => {
    expect([percent(undefined), ms(null), ms(undefined)]).toEqual(["–", "–", "–"]);
    expect([percent(0.456), ms(326.4)]).toEqual(["46%", "326 ms"]);
  });

  it("raises the neuron meter at 70% of the free tier and calls it full once it is spent", () => {
    expect(meterLevel(0, 10_000)).toBe("ok");
    expect(meterLevel(7_000, 10_000)).toBe("ok");
    expect(meterLevel(7_001, 10_000)).toBe("high");
    expect(meterLevel(9_999, 10_000)).toBe("high");
    expect(meterLevel(10_000, 10_000)).toBe("full");
    expect(meterLevel(26_347, 10_000)).toBe("full");
  });
});
