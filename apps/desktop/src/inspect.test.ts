import { describe, expect, it } from "vitest";
import { policyFacts } from "./inspect.ts";

describe("policyFacts", () => {
  it("says what a model player is shown and how it is asked", () => {
    expect(policyFacts("clef:clef-flash:json-fx:choice:full")).toMatchObject({
      model: "clef-flash",
      encoder: "json-fx",
      level: "forecast",
      style: "full",
    });
    expect(policyFacts("clef:clef-flash:json:choice:full")?.level).toBe("now");
  });

  it("names the words level, the rules style and who times the hops", () => {
    expect(policyFacts("clef:clef-flash:lanes:choice:rules")).toMatchObject({
      level: "words",
      style: "rules",
      timedBy: null,
    });
    expect(policyFacts("clef:clef-flash:lanes:maneuver:rules")?.timedBy).toBe("controller");
    expect(policyFacts("clef:clef-flash:scene:route:lookup")?.timedBy).toBe("controller");
    expect(policyFacts("clef:clef-flash:scene:route-live:lookup")?.timedBy).toBe("model");
    expect(policyFacts("clef:clef-flash:json-fx:choice:full")?.timedBy).toBeNull();
  });

  it("has nothing to say about players that never ask a model", () => {
    expect(policyFacts(null)).toBeNull();
    expect(policyFacts("lookahead")).toBeNull();
    expect(policyFacts("always-forward")).toBeNull();
  });
});
