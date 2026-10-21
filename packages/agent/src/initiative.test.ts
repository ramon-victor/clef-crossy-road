import { describe, expect, it } from "vitest";
import { decidedBy, isLive, isLiveWait } from "./initiative.ts";

const model = (extra: Record<string, unknown>) => ({ source: "model" as const, extra });

describe("decidedBy: who made the move", () => {
  it("credits the moves the controller made after an answer to the controller", () => {
    expect(
      decidedBy({ source: "executor", extra: { controller: { kind: "walk", n: 2, left: 3 } } }),
    ).toBe("controller");
  });

  it("credits the move a consultation ends in to the model, including leaving a cell or a platform", () => {
    expect(decidedBy(model({ maneuver: "cross_ahead", controller: { kind: "hop" } }))).toBe(
      "model",
    );
    expect(decidedBy(model({ maneuver: "step_off", controller: { kind: "dodge", left: 1 } }))).toBe(
      "model",
    );
    expect(
      decidedBy(
        model({ maneuver: "leave_platform", controller: { kind: "leave", n: 1, left: 2 } }),
      ),
    ).toBe("model");
    expect(decidedBy({ source: "model" })).toBe("model");
  });

  it("credits a hold to the controller when it refused what the model chose, and to the model when it chose to wait", () => {
    const hold = { kind: "hold", why: "exposed" };
    expect(decidedBy(model({ maneuver: "cross_ahead", controller: hold }))).toBe("controller");
    expect(decidedBy(model({ maneuver: "wait_here", controller: hold }))).toBe("model");
    expect(
      decidedBy(model({ maneuver: "wait_here", controller: { kind: "hold", why: "refused" } })),
    ).toBe("model");
  });

  it("credits the model's own wait for a gap to the model, even when nobody could help the chicken", () => {
    for (const why of ["refused", "exposed", "edge"]) {
      expect(decidedBy(model({ maneuver: "wait_gap", controller: { kind: "hold", why } }))).toBe(
        "model",
      );
    }
  });

  it("knows a decision made by route-live, and a wait the model spent step by step", () => {
    const wait = { live: true, controller: { kind: "wait", n: 2, of: null, cell: "water" } };
    expect(isLive({ extra: wait })).toBe(true);
    expect(isLiveWait({ extra: wait })).toBe(true);
    expect(isLiveWait({ extra: { live: true, controller: { kind: "hop" } } })).toBe(false);
    // The scripted references and the assisted route never mark a decision as live.
    expect(
      isLiveWait({ extra: { controller: { kind: "wait", n: 2, of: 15, cell: "water" } } }),
    ).toBe(false);
    expect(isLive({})).toBe(false);
  });

  it("credits a manoeuvre begun in place of the one the model chose to the controller", () => {
    expect(
      decidedBy(
        model({ maneuver: "cross_ahead", fallback: "detour_right", controller: { kind: "walk" } }),
      ),
    ).toBe("controller");
  });
});
