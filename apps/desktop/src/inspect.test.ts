import { describe, expect, it } from "vitest";
import { policyFacts } from "./inspect.ts";

describe("policyFacts", () => {
  it("says what a model player is shown and how it is asked", () => {
    expect(policyFacts("clef:clef-flash:json-fx:choice:full")).toMatchObject({
      model: "clef-flash",
      encoder: "json-fx",
      level: "forecast",
      sees: expect.stringContaining("0.2 s"),
      style: expect.stringContaining("what each move does"),
    });
    expect(policyFacts("clef:clef-flash:json:choice:full")?.level).toBe("now");
  });

  it("names the words level, the rules style and the executor", () => {
    expect(policyFacts("clef:clef-flash:lanes:choice:rules")).toMatchObject({
      level: "words",
      sees: expect.stringContaining("in words"),
      style: expect.stringContaining("fields of the state"),
      executor: false,
    });
    expect(policyFacts("clef:clef-flash:lanes:maneuver:rules")?.executor).toBe(true);
    expect(policyFacts("clef:clef-flash:json-fx:choice:full")?.executor).toBe(false);
  });

  it("has nothing to say about players that never ask a model", () => {
    expect(policyFacts(null)).toBeNull();
    expect(policyFacts("lookahead")).toBeNull();
    expect(policyFacts("always-forward")).toBeNull();
  });
});
