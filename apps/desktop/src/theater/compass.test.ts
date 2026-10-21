import type { Action } from "@ccr/core";
import { describe, expect, it } from "vitest";
import { buildCompass, STRIP_MOVES, stripOf } from "./compass.ts";
import { answeredSession, readingSession, routeAnswers } from "./test-support.ts";

describe("compass model context, separate from live execution", () => {
  it("shows five quiet directions while the model reads, without selecting one", () => {
    const s = readingSession(routeAnswers("no_stand", "still", "detour_right", 0.1));
    const view = buildCompass(s.state());
    expect(view.mode).toBe("reading");
    expect(view.moves).toHaveLength(5);
    expect(view.moves.every((m) => !m.blocked && m.p === null && !m.chosen)).toBe(true);
    expect(view.since).toEqual(expect.any(Number));
  });

  it("carries how much the model wanted each move, and which one it chose", async () => {
    const s = await answeredSession(routeAnswers("stand", "still", "wait_here", 0.9), 1);
    const { moves } = buildCompass(s.state());
    const p = Object.fromEntries(moves.map((m) => [m.action, m.p]));
    expect(p.hop_forward).toBeCloseTo(0.95, 3);
    expect(p.hop_left).toBeCloseTo(0.01, 3);
    expect(p.hop_right).toBeCloseTo(0.03, 3);
    expect(p.stay).toBeCloseTo(0.01, 3);
    expect(p.hop_back).toBe(0);
    expect(moves.filter((m) => m.chosen).map((m) => m.action)).toEqual(["hop_forward"]);
  });

  it("has no share when the strategy gives no probabilities", async () => {
    const state = (
      await answeredSession(routeAnswers("stand", "still", "wait_here", 0.9), 1)
    ).state();
    if (!state.lastModel) throw new Error("missing answer");
    const bare = {
      ...state.lastModel,
      decision: { action: state.lastModel.action, source: "model" as const },
    };
    const { moves } = buildCompass({ ...state, lastModel: bare, last: bare });
    expect(moves).toHaveLength(5);
    expect(moves.every((m) => m.p === null)).toBe(true);
  });

  it("keeps the chosen manoeuvre as context when its first step is backwards", async () => {
    const s = await answeredSession(routeAnswers("no_stand", "still", "detour_right", 0.1));
    const state = s.state();
    if (!state.lastModel) throw new Error("missing answer");
    // A boxed-in detour starts back (covered by the route tests), despite its rightward choice.
    const back = {
      ...state.lastModel,
      action: "hop_back" as const,
      decision: { ...state.lastModel.decision, action: "hop_back" as const },
    };
    const view = buildCompass({ ...state, lastModel: back, last: back });
    expect(view.verdict).toBe("Detour right");
    expect(view.moves.find((m) => m.blocked)).toMatchObject({ action: "hop_forward", p: null });
    expect(view.moves.find((m) => m.chosen)?.action).toBe("hop_right");
    expect(view.moves.find((m) => m.action === "hop_right")?.p).toBeCloseTo(0.6, 3);
    expect(view.doing).toContain("walking the detour");
  });

  it("labels a held controller step as next and a crossing as when-clear only after a real wait", async () => {
    const s = await answeredSession(routeAnswers("stand", "still", "wait_here", 0.9), 1);
    const state = s.state();
    if (!state.lastModel) throw new Error("missing answer");
    expect(buildCompass(state).verdict).toBe("Go straight");
    const wait = {
      ...state.lastModel,
      action: "stay" as const,
      decision: {
        action: "stay" as const,
        source: "executor" as const,
        extra: { controller: { kind: "wait", n: 2, of: 15, cell: "vehicle" } },
      },
    };
    const waiting = { ...state, last: wait, turns: [{ model: state.lastModel, steps: [wait] }] };
    expect(buildCompass(waiting).verdict).toBe("Go straight · when clear");
    expect(buildCompass(waiting).doing).toBe("waiting for a vehicle to pass 2/15");
    expect(buildCompass({ ...waiting, phase: "reading" }).doing).toBe(
      "next: waiting for a vehicle to pass 2/15",
    );
  });

  it("retains the move history across controller steps and hides context on reset, error or game over", async () => {
    const s = await answeredSession(routeAnswers("no_stand", "still", "detour_right", 0.1), 4, 2);
    const state = s.state();
    const { strip } = buildCompass(state);
    expect(strip.length).toBeGreaterThanOrEqual(3);
    expect(strip.length).toBeLessThanOrEqual(STRIP_MOVES);
    expect(strip[0]?.big).toBe(true);
    expect(strip.slice(1).every((chip) => !chip.big)).toBe(true);
    for (const change of [{ alive: false }, { stalled: true }, { phase: "error" as const }])
      expect(buildCompass({ ...state, ...change }).mode).toBe("hidden");
    s.start(4);
    expect(buildCompass(s.state()).mode).toBe("hidden");
  });
});

describe("stripOf: the latest moves under the game", () => {
  const entry = (
    index: number,
    action: Action,
    source: "model" | "executor",
    controller?: unknown,
  ) =>
    ({
      index,
      action,
      decision: { action, source, ...(controller === undefined ? {} : { extra: { controller } }) },
    }) as never;

  it("folds a run of waits for a gap into one chip with the count", () => {
    const wait = { kind: "wait", n: 1, of: 15, cell: "vehicle" };
    const chips = stripOf([
      entry(0, "stay", "model", wait), // the model's own decision is its own chip
      entry(1, "stay", "executor", wait),
      entry(2, "stay", "executor", wait),
      entry(3, "stay", "executor", wait),
      entry(4, "hop_forward", "executor", { kind: "hop" }),
    ]);
    expect(chips.map((c) => [c.glyph, c.big, c.count])).toEqual([
      ["•", true, 1],
      ["•", false, 3],
      ["↑", false, 1],
    ]);
  });

  it("does not fold waits that are not in one run, nor moves that are not waits", () => {
    const wait = { kind: "wait", n: 1, of: 15, cell: "vehicle" };
    const chips = stripOf([
      entry(0, "stay", "executor", wait),
      entry(1, "hop_left", "executor", { kind: "walk", n: 1, left: 2 }),
      entry(2, "stay", "executor", wait),
    ]);
    expect(chips.map((c) => c.count)).toEqual([1, 1, 1]);
  });

  it("keeps only the latest few chips", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      entry(i, i % 2 ? "hop_left" : "hop_right", "executor", { kind: "walk", n: i, left: 1 }),
    );
    expect(stripOf(many)).toHaveLength(STRIP_MOVES);
  });
});
