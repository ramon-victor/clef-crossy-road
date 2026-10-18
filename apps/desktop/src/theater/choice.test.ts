import { describe, expect, it } from "vitest";
import type { DecisionLog } from "../session.ts";
import { barsOf, branchText, modelChoice, winnerOf } from "./choice.ts";

const answer = (picked: string, probabilities: Record<string, number>) => ({
  choice: picked,
  probabilities,
});

const AROUND = answer("detour_right", { detour_left: 0.2, detour_right: 0.6, wait_here: 0.2 });

const logOf = (
  extra: Record<string, unknown> | undefined,
  overrides: Partial<DecisionLog["decision"]> = {},
  action: DecisionLog["action"] = "hop_forward",
): DecisionLog => ({
  index: 0,
  tick: 0,
  row: 0,
  action,
  wallMs: 1,
  decision: {
    action,
    source: "model",
    answers: { around: AROUND },
    ...(extra ? { extra } : {}),
    ...overrides,
  },
});

describe("winnerOf: the move the model chose", () => {
  it.each([
    ["cross_ahead", "hop_back", "hop_forward"],
    ["detour_right", "hop_back", "hop_right"],
    ["wait_here", "hop_back", "stay"],
    ["leave_platform", "hop_left", "hop_left"],
    [undefined, "hop_left", "hop_left"],
  ] as const)("%s, with the controller's first hop %s, is %s", (maneuver, first, expected) => {
    expect(winnerOf(logOf(maneuver ? { maneuver } : undefined, {}, first))).toBe(expected);
  });
});

describe("barsOf: the moves within the fork the routing took", () => {
  it("shows the ways round, and a block ahead, when the way is closed", () => {
    const bars = barsOf(logOf({ maneuver: "detour_right", ahead: "closed", pClosed: 0.45 }));
    expect(bars?.p).toEqual({
      hop_forward: 0,
      hop_back: 0,
      hop_left: 0.2,
      hop_right: 0.6,
      stay: 0.2,
    });
    expect([...(bars?.blocked ?? [])]).toEqual(["hop_forward"]);
    expect(bars?.branch).toEqual({ kind: "closed", p: 0.45 });
  });

  it("lights the biggest bar even where the joint probabilities put 'go straight' first", () => {
    // P(stand) 0.45 and P(moving) 0.5 make the joint chance of crossing 0.725, yet the answers taken one by
    // one say no and still: the way is closed (22% of the answers on seeds 6 to 8 looked like this).
    const bars = barsOf(logOf({ maneuver: "detour_right", ahead: "closed", pClosed: 0.275 }));
    const biggest = Object.entries(bars?.p ?? {}).sort((a, b) => b[1] - a[1])[0];
    expect(biggest?.[0]).toBe("hop_right");
  });

  it.each([
    ["open", "the way ahead is open"],
    ["passing", "things pass on the way ahead"],
  ])(
    "sizes a way that is %s by the chance of crossing, with the ways round as the rest",
    (ahead) => {
      const bars = barsOf(logOf({ maneuver: "cross_ahead", ahead, pClosed: 0.2 }));
      expect(bars?.p.hop_forward).toBeCloseTo(0.8, 5);
      expect(bars?.p.hop_right).toBeCloseTo(0.12, 5);
      expect(bars?.blocked.size).toBe(0);
      expect(bars?.branch).toEqual({ kind: ahead, p: 0.8 });
    },
  );

  it("puts the answer to `ride` on the hop that gets the chicken off a platform, and nothing on the rest", () => {
    const bars = barsOf(
      logOf(
        { maneuver: "leave_platform", ahead: "open", pClosed: 0.1, pLeaving: 0.8 },
        {},
        "hop_back",
      ),
    );
    expect(bars?.p).toEqual({ hop_forward: 0, hop_back: 0.8, hop_left: 0, hop_right: 0, stay: 0 });
    expect(bars?.branch).toEqual({ kind: "leaving", p: 0.8 });
  });

  it("keeps the probabilities of a strategy with no routing, and has none to draw without them", () => {
    const plain = logOf(undefined, { answers: {}, probabilities: { hop_left: 0.7, stay: 0.3 } });
    expect(barsOf(plain)).toEqual({
      p: { hop_forward: 0, hop_back: 0, hop_left: 0.7, hop_right: 0, stay: 0.3 },
      blocked: new Set(),
      branch: null,
    });
    expect(barsOf(logOf(undefined, { answers: {} }))).toBeNull();
  });
});

describe("modelChoice", () => {
  it("is the move and the bars of a model's decision, and nothing for a step of the controller", () => {
    const decision = logOf({ maneuver: "wait_here", ahead: "closed", pClosed: 0.6 });
    expect(modelChoice(decision)).toMatchObject({ move: "stay" });
    const step = logOf(undefined, { source: "executor" });
    expect(modelChoice(step)).toBeNull();
  });
});

describe("branchText", () => {
  it("says the fork and how sure it was", () => {
    expect(branchText({ kind: "closed", p: 0.304 })).toBe("the way ahead is closed 30%");
  });
});
